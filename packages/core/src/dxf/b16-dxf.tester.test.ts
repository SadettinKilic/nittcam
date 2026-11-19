/* eslint-disable @typescript-eslint/no-non-null-assertion -- test lookups on known drawings */
/**
 * B16 tester 2 (T144–T145): hand-built nasty DXFs checked against independently computed
 * geometry (not against the reader's own helpers): OCS mirror of arcs, mirrored / rotated INSERT
 * with a block base point, nested blocks, LWPOLYLINE bulge area, a rational NURBS circle and
 * ELLIPSE within CURVE_TOL, inch / unitless / huge / tiny units, join tolerance edges, reversed
 * duplicates, branches, island-in-cut-out, drill circles → holes, non-finite coordinates.
 * Safety: imported parts go through the same toolpath / post / reader checks as drawn parts and
 * cannot bypass a refusal.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { CURVE_TOL, JOIN_TOL } from '../geometry/constants';
import { signedArea } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Polyline } from '../geometry/types';
import { nestProject } from '../nesting';
import { goldenProfile } from '../post/golden.testing';
import type { Project } from '../schema';
import { buildToolpath } from '../toolpath/build';
import { projectOf } from '../toolpath/toolpath.testing';
import { distToSegment } from './curves';
import { dxfImportParts, planDxfImport } from './plan';
import { readDxf } from './read';
import type { DxfDrawing } from './types';

// ------------------------------------------------------------------------------------------
// DXF builder (independent of the fixture generator)
// ------------------------------------------------------------------------------------------

type G = [number, string | number][];
const pairs = (g: G) => g.map(([c, v]) => `${c}\n${v}\n`).join('');

const LINE = (l: string, x1: number, y1: number, x2: number, y2: number): G => [
  [0, 'LINE'],
  [8, l],
  [10, x1],
  [20, y1],
  [30, 0],
  [11, x2],
  [21, y2],
  [31, 0],
];
const ARC = (l: string, cx: number, cy: number, r: number, a0: number, a1: number, nz = 1): G => [
  [0, 'ARC'],
  [8, l],
  [10, cx],
  [20, cy],
  [30, 0],
  [40, r],
  ...(nz === 1
    ? []
    : ([
        [210, 0],
        [220, 0],
        [230, nz],
      ] as G)),
  [50, a0],
  [51, a1],
];
const CIRCLE = (l: string, cx: number, cy: number, r: number): G => [
  [0, 'CIRCLE'],
  [8, l],
  [10, cx],
  [20, cy],
  [30, 0],
  [40, r],
];
const LWPOLY = (l: string, pts: [number, number, number?][], closed = true): G => [
  [0, 'LWPOLYLINE'],
  [8, l],
  [90, pts.length],
  [70, closed ? 1 : 0],
  ...pts.flatMap(([x, y, b]) => [[10, x], [20, y], ...(b ? [[42, b]] : [])] as G),
];
const RECT = (l: string, x0: number, y0: number, x1: number, y1: number): G =>
  LWPOLY(l, [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);
const INSERT = (l: string, name: string, x: number, y: number, sx = 1, sy = 1, rot = 0): G => [
  [0, 'INSERT'],
  [8, l],
  [2, name],
  [10, x],
  [20, y],
  [30, 0],
  [41, sx],
  [42, sy],
  [50, rot],
];
const BLOCK = (name: string, bx: number, by: number, body: G[]): G => [
  [0, 'BLOCK'],
  [8, '0'],
  [2, name],
  [70, 0],
  [10, bx],
  [20, by],
  [30, 0],
  [3, name],
  ...body.flat(),
  [0, 'ENDBLK'],
  [8, '0'],
];

function dxf(entities: G[], opts: { insunits?: number | null; blocks?: G[] } = {}): string {
  const ins = opts.insunits === undefined ? 4 : opts.insunits;
  const header: G = [
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, 'AC1015'],
    ...(ins === null
      ? []
      : ([
          [9, '$INSUNITS'],
          [70, ins],
        ] as G)),
    [0, 'ENDSEC'],
  ];
  const blocks: G = opts.blocks
    ? [[0, 'SECTION'], [2, 'BLOCKS'], ...opts.blocks.flat(), [0, 'ENDSEC']]
    : [];
  return (
    pairs(header) +
    pairs(blocks) +
    pairs([[0, 'SECTION'], [2, 'ENTITIES'], ...entities.flat(), [0, 'ENDSEC'], [0, 'EOF']])
  );
}

function read(text: string, unit?: 'mm' | 'in'): DxfDrawing {
  const r = readDxf(text, unit ? { unit } : {});
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Dense samples of a polyline (arcs sampled with 512 steps). */
function samples(poly: Polyline): Point[] {
  const vs = poly.vertices;
  const n = vs.length;
  const count = poly.closed ? n : n - 1;
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = vs[i]!;
    const b = vs[(i + 1) % n]!;
    const pts = a.bulge === 0 ? [a, b] : sampleSegment(a, b, a.bulge, 512);
    // midpoints of straight chords matter for the curve tolerance, so add them
    for (let k = 0; k + 1 < pts.length; k++) {
      out.push(pts[k]!, { x: (pts[k]!.x + pts[k + 1]!.x) / 2, y: (pts[k]!.y + pts[k + 1]!.y) / 2 });
    }
    out.push(pts[pts.length - 1]!);
  }
  return out;
}

function distToPoly(p: Point, poly: Polyline): number {
  const s = samples(poly);
  let best = Infinity;
  for (let k = 0; k + 1 < s.length; k++) best = Math.min(best, distToSegment(p, s[k]!, s[k + 1]!));
  return best;
}

const allPolys = (d: DxfDrawing) => d.paths.map((p) => p.poly);
const near = (p: Point, d: DxfDrawing) => Math.min(...allPolys(d).map((pl) => distToPoly(p, pl)));

// ------------------------------------------------------------------------------------------
// T144 geometry
// ------------------------------------------------------------------------------------------

describe('B16 tester: arcs, bulges and OCS mirror', () => {
  it('ARC 0°→90° is CCW: the 45° point is on it, the 225° point is not', () => {
    const d = read(dxf([ARC('A', 0, 0, 50, 0, 90)]));
    const r = 50;
    const at = (deg: number) => ({
      x: r * Math.cos((deg * Math.PI) / 180),
      y: r * Math.sin((deg * Math.PI) / 180),
    });
    expect(near(at(45), d)).toBeLessThan(1e-6);
    expect(near(at(225), d)).toBeGreaterThan(10);
  });

  it('ARC 300°→60° wraps through 0°', () => {
    const d = read(dxf([ARC('A', 0, 0, 50, 300, 60)]));
    expect(near({ x: 50, y: 0 }, d)).toBeLessThan(1e-6);
    expect(near({ x: -50, y: 0 }, d)).toBeGreaterThan(10);
  });

  it('ARC with extrusion (0,0,-1) is mirrored in X (OCS → WCS)', () => {
    // OCS centre (10,0), 0°→90°: WCS centre (-10,0), the arc bulges up-left.
    const d = read(dxf([ARC('A', 10, 0, 10, 0, 90, -1)]));
    const m = Math.SQRT1_2 * 10;
    expect(near({ x: -10 - m, y: m }, d)).toBeLessThan(1e-6);
    expect(near({ x: 10 + m, y: m }, d)).toBeGreaterThan(5);
    expect(near({ x: -10 + m, y: -m }, d)).toBeGreaterThan(5);
  });

  it('LWPOLYLINE bulge: area of a square with one bulged edge matches the circular segment', () => {
    for (const b of [0.5, -0.5, 1]) {
      const d = read(
        dxf([
          LWPOLY('A', [
            [0, 0, b],
            [100, 0],
            [100, 100],
            [0, 100],
          ]),
        ]),
      );
      const th = 4 * Math.atan(Math.abs(b));
      const r = 100 / (2 * Math.sin(th / 2));
      const seg = ((r * r) / 2) * (th - Math.sin(th));
      // CCW square, edge along +X: positive bulge = CCW arc = bulges outward (below)
      const expected = 10000 + (b > 0 ? seg : -seg);
      expect(Math.abs(signedArea(d.paths[0]!.poly))).toBeCloseTo(expected, 6);
    }
  });
});

describe('B16 tester: INSERT transforms', () => {
  // A "D": vertical line x=0 from y=0..100 and the right half circle around (0,50), r=50.
  const D = BLOCK('D', 0, 50, [LINE('0', 0, 0, 0, 100), ARC('0', 0, 50, 50, -90, 90)]);

  it('mirror (xscale −1) with a block base point: the arc bulges left', () => {
    const d = read(dxf([INSERT('K', 'D', 200, 0, -1, 1, 0)], { blocks: [D] }));
    // local (50,50) − base (0,50) = (50,0) → mirror (−50,0) → + (200,0) = (150,0)
    expect(near({ x: 150, y: 0 }, d)).toBeLessThan(1e-6);
    expect(near({ x: 250, y: 0 }, d)).toBeGreaterThan(10);
    expect(d.layers).toEqual(['K']); // layer 0 inside a block takes the INSERT's layer
  });

  it('mirror + 90° rotation', () => {
    const d = read(dxf([INSERT('K', 'D', 200, 0, -1, 1, 90)], { blocks: [D] }));
    // (50,0) → (−50,0) → rot 90 → (0,−50) → (200,−50)
    expect(near({ x: 200, y: -50 }, d)).toBeLessThan(1e-6);
    expect(near({ x: 200, y: 50 }, d)).toBeGreaterThan(10);
  });

  it('negative yscale (mirror in Y) + 30°', () => {
    const d = read(dxf([INSERT('K', 'D', 0, 0, 2, -2, 30)], { blocks: [D] }));
    // (50,0) → scale (100,0) → rot 30 → (86.60, 50)
    const c = Math.cos(Math.PI / 6);
    expect(near({ x: 100 * c, y: 50 }, d)).toBeLessThan(1e-6);
    // the line end (0,100)-(0,50) = (0,50) → (0,−100) → rot 30 → (50, −86.60)
    expect(near({ x: 50, y: -100 * c }, d)).toBeLessThan(1e-6);
  });

  it('nested blocks: the inner INSERT is reported as skipped, the rest is read', () => {
    const inner = BLOCK('IN', 0, 0, [CIRCLE('0', 0, 0, 5)]);
    const outer = BLOCK('OUT', 0, 0, [RECT('0', 0, 0, 100, 100), INSERT('0', 'IN', 50, 50)]);
    const d = read(dxf([INSERT('K', 'OUT', 0, 0)], { blocks: [inner, outer] }));
    expect(d.report.skipped.NESTED_INSERT).toBe(1);
    expect(d.paths).toHaveLength(1);
  });

  it('a missing block is reported, not a crash', () => {
    const d = read(dxf([INSERT('K', 'NOPE', 0, 0), RECT('A', 0, 0, 100, 100)]));
    expect(d.report.skipped.MISSING_BLOCK).toBe(1);
  });
});

describe('B16 tester: SPLINE / ELLIPSE within CURVE_TOL (independent references)', () => {
  it('rational quadratic NURBS full circle (9 control points) stays within 0.01 mm of r=50', () => {
    const w = Math.SQRT1_2;
    const cps: [number, number, number][] = [
      [50, 0, 1],
      [50, 50, w],
      [0, 50, 1],
      [-50, 50, w],
      [-50, 0, 1],
      [-50, -50, w],
      [0, -50, 1],
      [50, -50, w],
      [50, 0, 1],
    ];
    const knots = [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1];
    const spline: G = [
      [0, 'SPLINE'],
      [8, 'S'],
      [70, 8 + 4 + 1],
      [71, 2],
      [72, knots.length],
      [73, cps.length],
      [74, 0],
      ...knots.map((k) => [40, k] as [number, number]),
      ...cps.map(([, , ww]) => [41, ww] as [number, number]),
      ...cps.flatMap(
        ([x, y]) =>
          [
            [10, x],
            [20, y],
            [30, 0],
          ] as G,
      ),
    ];
    const d = read(dxf([spline]));
    expect(d.report.converted.SPLINE).toBe(1);
    let worst = 0;
    for (const p of samples(d.paths[0]!.poly))
      worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - 50));
    expect(worst).toBeLessThanOrEqual(CURVE_TOL + 1e-9);
    const plan = planDxfImport(d);
    expect(plan.parts).toHaveLength(1);
  });

  it('rotated partial ELLIPSE: every sample within 0.01 mm of the true ellipse', () => {
    // centre (100,100), major axis endpoint (40,40) → a = 56.57, ratio 0.3, params 0.5..2.5
    const ell: G = [
      [0, 'ELLIPSE'],
      [8, 'E'],
      [10, 100],
      [20, 100],
      [30, 0],
      [11, 40],
      [21, 40],
      [31, 0],
      [40, 0.3],
      [41, 0.5],
      [42, 2.5],
    ];
    const d = read(dxf([ell]));
    const a = Math.hypot(40, 40);
    const b = 0.3 * a;
    const ang = Math.PI / 4;
    // distance to the ellipse by dense parametric search
    const ref: Point[] = [];
    for (let i = 0; i <= 20000; i++) {
      const t = 0.5 + (2 * i) / 20000;
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      ref.push({
        x: 100 + x * Math.cos(ang) - y * Math.sin(ang),
        y: 100 + x * Math.sin(ang) + y * Math.cos(ang),
      });
    }
    let worst = 0;
    for (const p of samples(d.paths[0]!.poly)) {
      let best = Infinity;
      for (let k = 0; k + 1 < ref.length; k++)
        best = Math.min(best, distToSegment(p, ref[k]!, ref[k + 1]!));
      worst = Math.max(worst, best);
    }
    expect(worst).toBeLessThanOrEqual(CURVE_TOL + 1e-6);
    // endpoints at t = 0.5 and t = 2.5
    const vs = d.paths[0]!.poly.vertices;
    expect(Math.hypot(vs[0]!.x - ref[0]!.x, vs[0]!.y - ref[0]!.y)).toBeLessThan(1e-6);
    const last = vs[vs.length - 1]!;
    const end = ref[ref.length - 1]!;
    expect(Math.hypot(last.x - end.x, last.y - end.y)).toBeLessThan(1e-6);
  });
});

describe('B16 tester: units', () => {
  it('inch file: a 10 × 5 in rectangle is 254 × 127 mm, no question', () => {
    const d = read(dxf([RECT('A', 0, 0, 10, 5)], { insunits: 1 }));
    expect(d.units.unit).toBe('in');
    expect(d.units.uncertain).toBeUndefined();
    expect(d.bbox!.maxX - d.bbox!.minX).toBeCloseTo(254, 9);
    expect(d.bbox!.maxY - d.bbox!.minY).toBeCloseTo(127, 9);
  });

  it('missing / unitless always ask; a 2 mm drawing in mm asks with a suggestion', () => {
    expect(read(dxf([RECT('A', 0, 0, 100, 50)], { insunits: null })).units.uncertain?.reason).toBe(
      'missing',
    );
    expect(read(dxf([RECT('A', 0, 0, 100, 50)], { insunits: 0 })).units.uncertain?.reason).toBe(
      'unitless',
    );
    const tiny = read(dxf([RECT('A', 0, 0, 2, 1)]));
    expect(tiny.units.uncertain?.reason).toBe('size');
    expect(tiny.units.uncertain?.suggested).toBe('in');
  });

  it('a 50 m drawing in mm asks; a 1:1 sheet-sized drawing does not', () => {
    const huge = read(dxf([RECT('A', 0, 0, 50000, 1000)]));
    expect(huge.units.uncertain?.reason).toBe('size');
    expect(read(dxf([RECT('A', 0, 0, 2440, 1220)])).units.uncertain).toBeUndefined();
  });

  it('choosing the unit overrides the header and clears the question', () => {
    const d = read(dxf([RECT('A', 0, 0, 10, 5)], { insunits: 0 }), 'in');
    expect(d.units.uncertain).toBeUndefined();
    expect(d.bbox!.maxX).toBeCloseTo(254, 9);
  });
});

describe('B16 tester: dirty input never produces non-finite geometry', () => {
  it.each([
    ['huge coordinate', LINE('A', 0, 0, Number('1e309') as number, 0)],
    [
      'NaN text',
      [
        [0, 'LINE'],
        [8, 'A'],
        [10, 'nan'],
        [20, 0],
        [11, 5],
        [21, 5],
      ] as G,
    ],
    ['1e300 circle', CIRCLE('A', 0, 0, 1e300)],
  ])('%s: refused or skipped, never Infinity/NaN', (_, ent) => {
    const r = readDxf(dxf([ent, RECT('B', 0, 0, 100, 100)]));
    if (!r.ok) return;
    for (const p of r.value.paths)
      for (const v of p.poly.vertices) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.bulge)).toBe(true);
      }
  });
});

// ------------------------------------------------------------------------------------------
// T145 join and recognition
// ------------------------------------------------------------------------------------------

describe('B16 tester: join tolerance and dirty soups', () => {
  const sq = (gap: number): G[] => [
    LINE('A', 0, 0, 100, 0),
    LINE('A', 100, 100, 100 + gap, 0), // reversed and shifted
    LINE('A', 0, 100, 100, 100 + gap * 0.5), // reversed direction relative to the loop
    LINE('A', 0, 100, 0, gap), // gap at the start
  ];

  it(`gaps just under JOIN_TOL (${JOIN_TOL}) close; just over stay open`, () => {
    const ok = planDxfImport(read(dxf(sq(JOIN_TOL * 0.9))));
    expect(ok.parts).toHaveLength(1);
    expect(ok.open).toHaveLength(0);
    const bad = planDxfImport(read(dxf(sq(JOIN_TOL * 1.3))));
    expect(bad.parts).toHaveLength(0);
    expect(bad.open.length).toBeGreaterThan(0);
  });

  it('a reversed duplicate edge and a duplicated circle do not break the part', () => {
    const plan = planDxfImport(
      read(
        dxf([
          RECT('A', 0, 0, 200, 200),
          LINE('A', 200, 0, 0, 0), // reversed copy of the first edge
          CIRCLE('A', 100, 100, 20),
          CIRCLE('A', 100, 100, 20),
        ]),
      ),
    );
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]!.inners).toHaveLength(1);
    // Observed: a single LINE lying on an edge of a closed LWPOLYLINE is not a duplicate of a
    // whole piece, so it stays as one flagged open chain (never imported). Note, not a blocker.
    expect(plan.open).toHaveLength(1);
    expect(plan.duplicates).toBeGreaterThanOrEqual(1);
  });

  it('a T-branch (three lines in one point) does not crash and imports nothing bogus', () => {
    const plan = planDxfImport(
      read(dxf([LINE('A', 0, 0, 50, 0), LINE('A', 50, 0, 100, 0), LINE('A', 50, 0, 50, 50)])),
    );
    expect(plan.parts).toHaveLength(0);
    expect(plan.open.length).toBeGreaterThan(0);
  });
});

describe('B16 tester: recognition', () => {
  const nested = (map = {}) =>
    planDxfImport(
      read(
        dxf([
          RECT('A', 0, 0, 600, 600), // part
          RECT('A', 100, 100, 500, 500), // its cut-out
          RECT('A', 200, 200, 400, 400), // island = part again
          CIRCLE('A', 300, 300, 30), // cut-out of the island
          CIRCLE('DELIK', 50, 50, 5), // drill circles on the big part
          CIRCLE('DELIK', 550, 550, 5),
          CIRCLE('DELIK', 1000, 1000, 5), // outside any part → orphan
        ]),
      ),
      map,
    );

  it('outer → inner → island → inner of the island', () => {
    const plan = nested({ DELIK: 'drill' });
    expect(plan.parts).toHaveLength(2);
    const big = plan.parts.find((p) => p.box.maxX === 600)!;
    const island = plan.parts.find((p) => p.box.maxX === 400)!;
    expect(big.inners).toHaveLength(3); // cut-out + 2 drill circles
    expect(island.inners).toHaveLength(1);
    expect(plan.orphans).toHaveLength(1);
  });

  it('drill-layer circles become through holes (centre and diameter kept); others stay inners', () => {
    const plan = nested({ DELIK: 'drill' });
    const parts = dxfImportParts(
      plan,
      (i) => `p${i}`,
      (i) => `P${i}`,
      1,
    );
    const big = parts.find((p) => p.holes.length > 0)!;
    expect(big.holes.map((h) => [h.cx, h.cy, h.d])).toEqual(
      expect.arrayContaining([
        [50, 50, 10],
        [550, 550, 10],
      ]),
    );
    expect(big.inners).toHaveLength(1);
    const island = parts.find((p) => p !== big)!;
    expect(island.holes).toHaveLength(0); // a circle on an auto layer is an inner contour
    expect(island.inners).toHaveLength(1);
  });

  it('without the drill mapping the circles are just inner contours', () => {
    const plan = nested();
    const big = plan.parts.find((p) => p.box.maxX === 600)!;
    expect(big.inners.every((i) => !i.drill)).toBe(true);
    // the DELIK circle at (1000,1000) is a tiny part of its own then
    expect(plan.parts).toHaveLength(3);
  });
});

// ------------------------------------------------------------------------------------------
// Safety: imported parts go through the same pipeline and refusals
// ------------------------------------------------------------------------------------------

const profile = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

function imported(text: string, map = {}, holeTool?: number): Project {
  const plan = planDxfImport(read(text), map);
  const parts = dxfImportParts(
    plan,
    (i) => `dxf-${i + 1}`,
    (i) => `Parça ${i + 1}`,
    holeTool,
  );
  const r = applyCommand(projectOf({ parts: [] }), 'importDxf', { parts });
  if (!r.ok) throw new Error(r.error.message);
  return { ...r.project, layout: nestProject(r.project, { toolDiameter: 8 }).layout };
}

describe('B16 tester: imported parts export through the same checks', () => {
  const good = dxf([
    // a big plate with an arc edge, a slot and drill holes, plus a mirrored inserted bracket
    LWPOLY('KESIM', [
      [0, 0],
      [600, 0, 0.3],
      [600, 400],
      [0, 400],
    ]),
    LWPOLY('KESIM', [
      [100, 150, 1],
      [100, 250],
      [400, 250, 1],
      [400, 150],
    ]),
    CIRCLE('DELIK', 50, 50, 4),
    CIRCLE('DELIK', 550, 350, 4),
  ]);

  it.each(['generic', 'mach3'] as const)('%s: download allowed, no violations', (post) => {
    const p = imported(good, { DELIK: 'drill' }, 1);
    expect(p.parts).toHaveLength(1);
    const r = exportNc(p, profile(post), postConfig(post));
    expect(r.toolpathIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.check?.violations ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('a part larger than the sheet is refused by the toolpath like a drawn one', () => {
    const p = imported(dxf([RECT('A', 0, 0, 3000, 500)]));
    const r = exportNc(p, profile('generic'), postConfig('generic'));
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('an inner contour crossing a concave outline (inside layer) cannot be cut', () => {
    // L-shaped outline; the "inside" rectangle sits in the notch's bbox but crosses the edge.
    const text = dxf([
      LWPOLY('A', [
        [0, 0],
        [600, 0],
        [600, 200],
        [200, 200],
        [200, 600],
        [0, 600],
      ]),
      RECT('IC', 50, 50, 300, 300),
    ]);
    const plan = planDxfImport(read(text), { IC: 'inside' });
    const parts = dxfImportParts(
      plan,
      (i) => `d${i}`,
      (i) => `D${i}`,
    );
    const r0 = applyCommand(projectOf({ parts: [] }), 'importDxf', { parts });
    if (!r0.ok) return; // refused at import: fine
    const p = { ...r0.project, layout: nestProject(r0.project, { toolDiameter: 8 }).layout };
    const tp = buildToolpath(p, goldenProfile('generic'));
    if (p.parts.some((x) => x.kind === 'freeform' && x.inners.length > 0)) {
      expect(tp.ok).toBe(false);
      const r = exportNc(p, profile('generic'), postConfig('generic'));
      expect(r.ok).toBe(false);
      expect(r.files).toEqual([]);
    }
  });

  it('a drill hole smaller than nothing / with an unknown tool cannot reach the G-code', () => {
    const p = imported(
      dxf([RECT('A', 0, 0, 300, 300), CIRCLE('DELIK', 150, 150, 4)]),
      { DELIK: 'drill' },
      99, // no tool 99 in the profile
    );
    const r = exportNc(p, profile('generic'), postConfig('generic'));
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('importDxf refuses non-finite coordinates and empty imports at the command boundary', () => {
    const base = projectOf({ parts: [] });
    expect(applyCommand(base, 'importDxf', { parts: [] }).ok).toBe(false);
    const bad = applyCommand(base, 'importDxf', {
      parts: [
        {
          id: 'x',
          name: 'x',
          outline: [
            { x: 0, y: 0, bulge: 0 },
            { x: Infinity, y: 0, bulge: 0 },
            { x: 0, y: 10, bulge: 0 },
          ],
        },
      ],
    });
    expect(bad.ok).toBe(false);
  });
});
