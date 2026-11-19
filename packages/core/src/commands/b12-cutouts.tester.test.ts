/**
 * B12 tester (T134): cut-outs through the whole pipeline (nesting → toolpath → post → reader).
 * Read back from the G-code, not from the toolpath model: inside every placed opening the tool
 * centre stays exactly the tool radius away from the opening edge and never enters the part; the
 * cut-outs of a copy are cut before its outer contour, with no tabs; climb inside the opening.
 * A valid project with cut-outs must pass the export checks (rule 9); an invalid cut-out (too
 * small, crossing the outline, outside, overlapping) must stop the toolpath itself, so the server
 * export never depends on the client validation panel.
 */
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { forEachSegment, orientation } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Polyline, Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { exportNc } from '../export';
import { generateGcode } from '../post/generate';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Part, type Project } from '../schema';
import { buildToolpath, placedInners, placedOutline } from '../toolpath/build';
import { machineOf, passLoop, projectOf } from '../toolpath/toolpath.testing';
import { boardPositions } from '../editor/board';
import { applyCommand } from './index';
import { validateProject } from '../validate';

const TOOL_D = 8;
const R = TOOL_D / 2;
const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });

/** CW rectangle in the part frame. */
const rect = (x0: number, y0: number, x1: number, y1: number): Vertex[] => [
  v(x0, y0),
  v(x0, y1),
  v(x1, y1),
  v(x1, y0),
];
/** CW circle (two half arcs) of radius r at (cx, cy). */
const circle = (cx: number, cy: number, r: number): Vertex[] => [
  v(cx - r, cy, -1),
  v(cx + r, cy, -1),
];

function polyPoints(pl: Polyline): Point[] {
  const pts: Point[] = [];
  forEachSegment(pl, (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, 256);
    s.pop();
    pts.push(...s);
  });
  return pts;
}

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distTo(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, toSegment(p, poly[i] as Point, poly[(i + 1) % poly.length] as Point));
  }
  return best;
}

/** Tool-centre points of every feed / arc move below the sheet top, read from the program. */
function cutPoints(content: string): Point[] {
  const read = readGcode(content);
  expect(read.errors).toEqual([]);
  const out: Point[] = [];
  for (const m of read.moves) {
    if (m.type === 'rapid' || Math.min(m.from.z, m.to.z) >= 0) continue;
    if (m.arc) {
      const a0 = Math.atan2(m.from.y - m.arc.cy, m.from.x - m.arc.cx);
      const sweep = m.arc.direction === 'ccw' ? Math.abs(m.arc.sweep) : -Math.abs(m.arc.sweep);
      for (let k = 0; k <= 64; k++) {
        const a = a0 + (sweep * k) / 64;
        out.push({
          x: m.arc.cx + m.arc.radius * Math.cos(a),
          y: m.arc.cy + m.arc.radius * Math.sin(a),
        });
      }
    } else {
      for (let k = 0; k <= 32; k++) {
        out.push({
          x: m.from.x + ((m.to.x - m.from.x) * k) / 32,
          y: m.from.y + ((m.to.y - m.from.y) * k) / 32,
        });
      }
    }
  }
  return out;
}

type RawPart = Record<string, unknown>;

/** Shelf set (rect only) + 2 × "frame" with a rect and a round cut-out + 1 small "ring". */
function withCutouts(extra: (mk: (p: RawPart) => RawPart) => RawPart[] = () => []): Project {
  const src = structuredClone(goldenProject(shelfSet, TOOL_D)) as unknown as {
    parts: RawPart[];
  };
  const proto = src.parts[0] as RawPart;
  const mk = (p: RawPart): RawPart => ({
    ...proto,
    holes: [],
    templates: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    ...p,
  });
  src.parts.push(
    mk({
      id: 'frame',
      name: 'Çerçeve',
      qty: 2,
      params: { w: 600, h: 400, r: 0 },
      inners: [rect(80, 80, 300, 320), circle(450, 200, 60)],
    }),
    mk({
      id: 'ring',
      name: 'Halka',
      qty: 1,
      params: { w: 150, h: 150, r: 0 },
      inners: [circle(75, 75, 40)],
    }),
    ...extra(mk),
  );
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: TOOL_D }).layout,
  };
}

const profile = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

describe('B12 tester: cut-outs read back from the G-code (§7.2)', () => {
  it.each(['generic', 'mach3'] as const)(
    '%s: tool centre exactly R inside each opening, never in the part; inner before outer; no tabs',
    (post) => {
      const p = withCutouts();
      const tp = buildToolpath(p, goldenProfile(post));
      expect(tp.errors).toEqual([]);
      // The post alone (the rule-9 checks are covered by the export test below).
      const gc = generateGcode(tp.toolpath, profile(post), postConfig(post), {
        projectName: 'B12',
        revision: 1,
        fileStem: 'b12',
        stock: { material: 'mdf', thickness: 18, sheetWidth: 2800, sheetHeight: 2100 },
      });
      expect(gc.errors).toEqual([]);
      let checked = 0;
      for (const [si, sheet] of p.layout.sheets.entries()) {
        const all = cutPoints(gc.files[si]?.content ?? '');
        for (const pl of sheet.placements) {
          const part = p.parts.find((x) => x.id === pl.partId) as Part;
          if (part.inners.length === 0) continue;
          const outer = polyPoints(placedOutline(part, pl));
          const holes = placedInners(part, pl).map(polyPoints);
          for (const q of all) {
            const hole = holes.find((h) => inside(q, h));
            if (hole) expect(distTo(q, hole)).toBeGreaterThan(R - 0.01);
            else
              expect(inside(q, outer), `${pl.partId}#${pl.index}: centre in the part`).toBe(false);
          }
          for (const h of holes) {
            const near = all.filter((q) => inside(q, h));
            expect(near.length).toBeGreaterThan(0);
            for (const q of near) expect(Math.abs(distTo(q, h) - R)).toBeLessThan(0.05);
            checked++;
          }
          const ops = tp.toolpath.operations;
          const mine = ops.filter((o) => o.partId === pl.partId && o.copy === pl.index);
          const outerAt = ops.indexOf(mine.find((o) => o.kind === 'outerContour') as never);
          const inners = mine.filter((o) => o.kind === 'innerContour');
          expect(inners).toHaveLength(part.inners.length);
          for (const o of inners) {
            expect(ops.indexOf(o)).toBeLessThan(outerAt);
            expect(o.tabs).toEqual([]);
          }
        }
      }
      expect(checked).toBe(5); // 2 frames × 2 openings + 1 ring
    },
  );

  it.each([
    ['climb', 'ccw', 'cw'],
    ['conventional', 'cw', 'ccw'],
  ] as const)(
    '%s with a CW spindle: %s inside the opening, %s around the part (every pass)',
    (direction, innerTurn, outerTurn) => {
      const base = withCutouts();
      const p = { ...base, cutting: { ...base.cutting, direction } };
      const tp = buildToolpath(p, goldenProfile('generic'));
      const ring = tp.toolpath.operations.filter((o) => o.partId === 'ring');
      const inner = ring.find((o) => o.kind === 'innerContour');
      const outer = ring.find((o) => o.kind === 'outerContour');
      if (!inner || !outer) throw new Error('ops');
      inner.passDepths.forEach((_, i) => expect(orientation(passLoop(inner, i))).toBe(innerTurn));
      outer.passDepths.forEach((_, i) => expect(orientation(passLoop(outer, i))).toBe(outerTurn));
    },
  );

  it('free-angle rotation (30°): the openings keep their place relative to the outline', () => {
    const p = withCutouts();
    const part = p.parts.find((x) => x.id === 'frame') as Part;
    const at = { x: 300, y: 200, rot: 30 };
    const outer = placedOutline(part, at).vertices;
    const placed = placedInners(part, at);
    // Distances from the outline centre are kept (rigid motion).
    const cx = outer.reduce((a, q) => a + q.x, 0) / outer.length;
    const cy = outer.reduce((a, q) => a + q.y, 0) / outer.length;
    const sig = (vs: Point[], c: Point) =>
      vs.map((q) => Math.round(Math.hypot(q.x - c.x, q.y - c.y) * 1e4) / 1e4).sort((a, b) => a - b);
    expect(sig(placed[0]?.vertices ?? [], { x: cx, y: cy })).toEqual(
      sig(rect(80, 80, 300, 320), { x: 300, y: 200 }),
    );
    // Its sides are turned by exactly 30° (mod 90°), and the round one keeps its diameter.
    const iv = placed[0]?.vertices ?? [];
    iv.forEach((q, i) => {
      const n = iv[(i + 1) % iv.length] as Vertex;
      const a = ((((Math.atan2(n.y - q.y, n.x - q.x) * 180) / Math.PI) % 90) + 90) % 90;
      expect(Math.min(Math.abs(a - 30), Math.abs(a - 60))).toBeLessThan(1e-6);
    });
    const [a, b] = placed[1]?.vertices ?? [];
    expect(a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0).toBeCloseTo(120, 6);
  });
});

describe('B12 tester: a valid project with cut-outs exports (rule-9 checks pass)', () => {
  it.each(['generic', 'mach3'] as const)('%s: download allowed, no check violations', (post) => {
    const r = exportNc(withCutouts(), profile(post), postConfig(post));
    // Found in round 1: [LAYOUT PART_COUNT] "The program cuts 16 parts, the layout has 11." and
    // PART_POSITION: the independent check counts every cut-out loop as a part.
    expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('B12 tester: refused cut-outs stop the toolpath (never dropped, never cut)', () => {
  const cases: [string, Vertex[][], string][] = [
    ['too small for the tool', [rect(100, 100, 106, 160)], 'INNER_CONTOUR_TOO_SMALL'],
    ['crossing the outline', [rect(550, 100, 650, 200)], 'INNER_CONTOUR_INVALID'],
    ['completely outside the outline', [rect(700, 100, 800, 200)], 'INNER_CONTOUR_INVALID'],
    [
      'overlapping another cut-out',
      [rect(100, 100, 300, 300), rect(250, 250, 400, 350)],
      'INNER_CONTOUR_INVALID',
    ],
  ];
  it.each(cases)('%s: validation error, toolpath not ok, no G-code', (name, inners, code) => {
    const p = withCutouts((mk) => [
      mk({ id: 'bad', name: 'Hatalı', qty: 1, params: { w: 600, h: 400, r: 0 }, inners }),
    ]);
    const issues = validateProject(p, { machine: goldenProfile('generic') });
    expect(issues.map((i) => i.code)).toContain(code);
    // The server export runs only the toolpath + post + checks, not validateProject: the toolpath
    // must refuse a cut-out that would cut into the part edge or a neighbour.
    const tp = buildToolpath(p, goldenProfile('generic'));
    expect(tp.ok, `toolpath of a part with a cut-out ${name}`).toBe(false);
    expect(tp.errors.length).toBeGreaterThan(0);
    const r = exportNc(p, profile('generic'), postConfig('generic'));
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('toolpath');
    expect(r.files).toEqual([]);
  });
});

describe('B12 tester: dimensions and cut-outs follow a mirror (T133, T134)', () => {
  it.each(['h', 'v'] as const)(
    'mirror %s: dimension length kept and mirrored; cut-out stays inside',
    (axis) => {
      let p = projectOf({
        parts: [{ id: 'a', w: 300, h: 200 }],
        placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
      });
      const at = boardPositions(p).get('a');
      if (!at) throw new Error('board');
      const run = (name: string, params: unknown) => {
        const r = applyCommand(p, name, params);
        if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
        p = r.project;
      };
      run('addDimension', {
        id: 'a',
        dimId: 'd1',
        a: { x: at.x + 10, y: at.y + 20 },
        b: { x: at.x + 110, y: at.y + 70 },
      });
      run('addInnerContour', {
        id: 'a',
        vertices: [
          v(at.x + 20, at.y + 30),
          v(at.x + 120, at.y + 30),
          v(at.x + 120, at.y + 90),
          v(at.x + 20, at.y + 90),
        ],
        toolDiameter: 6,
      });
      run('mirrorPart', { ids: ['a'], axis });
      const part = p.parts[0] as Part;
      const d = part.dims?.[0];
      if (!d) throw new Error('dim');
      expect(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)).toBeCloseTo(Math.hypot(100, 50), 9);
      if (axis === 'h') expect([d.a.x, d.b.x]).toEqual([290, 190]);
      else expect([d.a.y, d.b.y]).toEqual([180, 130]);
      const xs = (part.inners[0] ?? []).map((q) => q.x).sort((a, b) => a - b);
      const ys = (part.inners[0] ?? []).map((q) => q.y).sort((a, b) => a - b);
      if (axis === 'h') expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([180, 280, 30, 90]);
      else expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([20, 120, 110, 170]);
      expect(
        validateProject(p, { toolDiameter: 6 }).filter((i) => i.code.startsWith('INNER')),
      ).toEqual([]);
      // Toolpath: the mirrored cut-out is still cut, inside the part, before the outer contour.
      const tp = buildToolpath(p, machineOf({ toolDiameter: 6, thickness: 18 }));
      expect(tp.errors).toEqual([]);
      expect(tp.toolpath.operations.map((o) => o.kind)).toEqual(['innerContour', 'outerContour']);
    },
  );
});
