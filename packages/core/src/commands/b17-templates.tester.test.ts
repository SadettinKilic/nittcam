/**
 * B17 tester (T147–T149):
 * - one undo step for addTemplate / updateTemplateInstance / removeTemplateInstance /
 *   updateTemplateVersion (CommandStack), overrides kept on a version update
 * - an asymmetric template with an inner contour and a line survives rotatePart / mirrorPart:
 *   update and remove afterwards leave no orphan or duplicate contours
 * - the migrated cabinet-doors fixture: every template instance reproduces its holes
 * - M5 exit: a left and a mirrored right door built with a hinge template export checked G-code
 *   (generic, mach3); read back independently: cups at 22.5 mm from the hinge edge, pocket to
 *   depth with the wall at d/2, screw holes pecked at the plunge feed with Z-only retracts
 */
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode, type GcodeMove } from '../gcode-reader';
import { exportNc } from '../export';
import { localBox } from '../editor/board';
import { goldenProfile } from '../post/golden.testing';
import {
  parseProject,
  type Hole,
  type Part,
  type Project,
  type TemplateGeometry,
  type TemplateParams,
} from '../schema';
import { deriveTemplate, defaultPlacement } from '../template';
import { projectOf } from '../toolpath/toolpath.testing';
import { CommandStack, applyCommand } from './index';

const ctx = { actor: 'user', at: '2026-11-19T10:00:00Z' } as const;

function run(p: Project, name: string, params: unknown): Project {
  const r = applyCommand(p, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message} ${JSON.stringify(r.error.issues)}`);
  return r.project;
}
const partOf = (p: Project, id: string) => p.parts.find((x) => x.id === id) as Part;

/** Cup Ø35 (pocket 13) + two Ø8 screws 9.5 further in, ±22.5 along the edge (tool 2 = Ø8). */
const hinge: TemplateGeometry = {
  holes: [
    { id: 'cup', type: 'pocket', d: 35, cx: 0, cy: 0, depth: 13, tool: 2 },
    { id: 's1', type: 'pocket', d: 8, cx: 9.5, cy: 22.5, depth: 10, tool: 2 },
    { id: 's2', type: 'pocket', d: 8, cx: 9.5, cy: -22.5, depth: 10, tool: 2 },
  ],
  inners: [],
};
const defaults: TemplateParams = { count: 2, spacing: 500, edgeDistance: 22.5, d: {} };

const W = 400;
const H = 700;

/** Two 400 × 700 doors on one sheet; `left` hinged on the left, `right` mirrored. */
function doors(): Project {
  let p = projectOf({
    parts: [
      { id: 'left', w: W, h: H },
      { id: 'right', w: W, h: H },
    ],
    placements: [
      [
        { partId: 'left', index: 0, x: 50, y: 50, rot: 0 },
        { partId: 'right', index: 0, x: 600, y: 50, rot: 0 },
      ],
    ],
  });
  const tpl = { templateId: 'tpl-hinge', version: 1, name: 'Menteşe', geometry: hinge, defaults };
  p = run(p, 'addTemplate', {
    id: 'left',
    template: { ...tpl, placement: defaultPlacement('left', { x: 22.5, y: H / 2 }) },
  });
  p = run(p, 'addTemplate', {
    id: 'right',
    template: {
      ...tpl,
      placement: { x: W - 22.5, y: H / 2, rot: 180, mirror: true, edge: 'right' },
    },
  });
  return p;
}

describe('B17 tester: undo steps and overrides', () => {
  it('each template command is exactly one undo step; overrides survive a version update', () => {
    const p0 = projectOf({ parts: [{ id: 'left', w: W, h: H }] });
    const s = new CommandStack(p0);
    const tpl = { templateId: 'tpl-hinge', version: 1, name: 'Menteşe', geometry: hinge, defaults };
    const steps: [string, unknown][] = [
      [
        'addTemplate',
        {
          id: 'left',
          template: { ...tpl, placement: defaultPlacement('left', { x: 22.5, y: H / 2 }) },
        },
      ],
      ['updateTemplateInstance', { id: 'left', instanceId: 't1', params: { spacing: 450 } }],
      [
        'updateTemplateVersion',
        {
          templateId: 'tpl-hinge',
          version: 2,
          geometry: hinge,
          defaults: { ...defaults, spacing: 520, edgeDistance: 24 },
        },
      ],
      ['removeTemplateInstance', { id: 'left', instanceId: 't1' }],
    ];
    const snaps = [JSON.stringify(s.project)];
    for (const [name, params] of steps) {
      const r = s.execute(name, params, ctx);
      expect(r.ok, name).toBe(true);
      snaps.push(JSON.stringify(s.project));
      if (name === 'updateTemplateVersion') {
        const ref = partOf(s.project, 'left').templates[0];
        expect(ref?.version).toBe(2);
        // Hand-set spacing kept; the untouched edge distance takes the new default.
        expect(ref?.params.spacing).toBe(450);
        expect(ref?.params.edgeDistance).toBe(24);
        expect(ref?.overrides).toEqual(['spacing']);
        const cups = partOf(s.project, 'left')
          .holes.filter((h) => h.id.includes('/cup/'))
          .map((h) => [h.cx, h.cy]);
        expect(cups).toEqual([
          [24, H / 2 - 225],
          [24, H / 2 + 225],
        ]);
      }
    }
    expect(partOf(s.project, 'left').holes).toEqual([]);
    for (let i = steps.length; i > 0; i--) {
      expect(JSON.stringify(s.project)).toBe(snaps[i]);
      s.undo();
    }
    expect(JSON.stringify(s.project)).toBe(snaps[0]);
  });
});

describe('B17 tester: rotate / mirror carry inner contours and lines', () => {
  /** Asymmetric: an L-ish offset rectangle cut-out, an engraving line and one hole. */
  const geo: TemplateGeometry = {
    holes: [{ id: 'h', type: 'pocket', d: 10, cx: 30, cy: 40, depth: 5, tool: 2 }],
    inners: [
      {
        contour: [
          { x: 20, y: -10, bulge: 0 },
          { x: 20, y: 10, bulge: 0 },
          { x: 70, y: 10, bulge: 0 },
          { x: 70, y: -10, bulge: 0 },
        ],
      },
    ],
    lines: [
      {
        vertices: [
          { x: 90, y: 0, bulge: 0 },
          { x: 110, y: 30, bulge: 0 },
        ],
        op: { kind: 'online', depth: 2 },
      },
    ],
  } as TemplateGeometry;
  const d1: TemplateParams = { count: 1, spacing: 0, edgeDistance: 30, d: {} };

  it.each([
    ['rotatePart', { ids: ['left'], turns: 90 }],
    ['rotatePart', { ids: ['left'], turns: 180 }],
    ['mirrorPart', { ids: ['left'], axis: 'h' }],
    ['mirrorPart', { ids: ['left'], axis: 'v' }],
  ] as const)('%s %o then update + remove: no orphans, no duplicates', (cmd, params) => {
    let p = projectOf({ parts: [{ id: 'left', w: W, h: H }] });
    p = run(p, 'addTemplate', {
      id: 'left',
      template: {
        templateId: 'x',
        version: 1,
        name: 'X',
        geometry: geo,
        defaults: d1,
        placement: defaultPlacement('left', { x: 30, y: 200 }),
      },
    });
    expect(partOf(p, 'left').inners).toHaveLength(1);
    expect(partOf(p, 'left').lines).toHaveLength(1);
    p = run(p, cmd, params);
    const side = partOf(p, 'left');
    const ref = side.templates[0];
    if (!ref) throw new Error('no ref');
    const again = deriveTemplate(ref, localBox(side));
    expect(again.inners.map((i) => i.contour)).toEqual(side.inners);
    expect(again.lines.map((l) => l.vertices)).toEqual(side.lines?.map((l) => l.vertices));
    expect(again.holes.map((h: Hole) => [h.cx, h.cy])).toEqual(side.holes.map((h) => [h.cx, h.cy]));
    p = run(p, 'updateTemplateInstance', {
      id: 'left',
      instanceId: 't1',
      params: { count: 2, spacing: 120 },
    });
    expect(partOf(p, 'left').inners).toHaveLength(2);
    expect(partOf(p, 'left').lines).toHaveLength(2);
    expect(partOf(p, 'left').holes).toHaveLength(2);
    p = run(p, 'removeTemplateInstance', { id: 'left', instanceId: 't1' });
    expect(partOf(p, 'left').inners).toEqual([]);
    expect(partOf(p, 'left').lines ?? []).toEqual([]);
    expect(partOf(p, 'left').holes).toEqual([]);
  });
});

describe('B17 tester: migrated cabinet-doors fixture', () => {
  it('parses, and every template instance reproduces the holes of its part', () => {
    const r = parseProject(structuredClone(cabinetDoors));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let seen = 0;
    for (const part of r.project.parts) {
      for (const ref of part.templates) {
        const derived = deriveTemplate(ref, localBox(part)).holes;
        // Same positions. NOTE (B17 tester): the fixture keeps the old hole ids (h1, h2), so the
        // instance does not own them by id (`t1/...`); see the PR comment.
        const owned = part.holes;
        expect(owned.map((h) => [h.d, h.cx, h.cy])).toEqual(derived.map((h) => [h.d, h.cx, h.cy]));
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe.each(['generic', 'mach3'] as const)('B17 tester: hinge doors to G-code (%s)', (post) => {
  const p = doors();
  const res = exportNc(
    p,
    { profile: goldenProfile(post), version: 1, verification: 'draft' },
    postConfig(post),
  );
  const moves: GcodeMove[] = res.files.flatMap((f) => readGcode(f.content).moves);
  const plungeFeed = 1500;

  // Independent expectation in the sheet frame (doors at (50,50) and (600,50), rot 0).
  const cupsY = [H / 2 - 250, H / 2 + 250];
  const cups = [
    ...cupsY.map((y) => ({ x: 50 + 22.5, y: 50 + y })),
    ...cupsY.map((y) => ({ x: 600 + W - 22.5, y: 50 + y })),
  ];
  const screws = [
    ...cupsY.flatMap((y) => [-22.5, 22.5].map((dy) => ({ x: 50 + 32, y: 50 + y + dy }))),
    ...cupsY.flatMap((y) => [-22.5, 22.5].map((dy) => ({ x: 600 + W - 32, y: 50 + y + dy }))),
  ];
  const at = (m: GcodeMove, c: { x: number; y: number }, tol = 1e-3) =>
    Math.hypot(m.to.x - c.x, m.to.y - c.y) < tol &&
    Math.hypot(m.from.x - c.x, m.from.y - c.y) < tol;

  it('exports with every check passed', () => {
    expect(res.toolpathIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(res.check?.violations ?? []).toEqual([]);
    expect(res.ok).toBe(true);
    expect(moves.length).toBeGreaterThan(0);
  });

  it('cups: 22.5 mm from the hinge edge, pocket to 13 mm, wall at d/2 (tool centre ≤ 13.5)', () => {
    for (const c of cups) {
      const near = moves.filter(
        (m) =>
          m.type !== 'rapid' &&
          Math.min(m.from.z, m.to.z) < 0 &&
          Math.hypot(m.to.x - c.x, m.to.y - c.y) < 20,
      );
      expect(near.length, `${c.x},${c.y}`).toBeGreaterThan(0);
      expect(Math.min(...near.map((m) => m.to.z))).toBeCloseTo(-13, 6);
      const r = near.map((m) => Math.hypot(m.to.x - c.x, m.to.y - c.y));
      expect(Math.max(...r)).toBeLessThanOrEqual(17.5 - 4 + 0.01);
      expect(Math.max(...r)).toBeGreaterThan(17.5 - 4 - 0.01);
    }
  });

  it('screws: pecked to 10 mm at the plunge feed, Z-only retract between pecks', () => {
    for (const c of screws) {
      const idx = moves.map((m, i) => ({ m, i })).filter(({ m }) => at(m, c));
      const plunges = idx.filter(({ m }) => m.to.z < m.from.z && m.to.z < 0);
      expect(plunges.length, `${c.x},${c.y}`).toBeGreaterThanOrEqual(2);
      for (const { m } of plunges) {
        expect(m.type).not.toBe('rapid');
        expect(m.feed).toBe(plungeFeed);
      }
      expect(Math.min(...plunges.map(({ m }) => m.to.z))).toBeCloseTo(-10, 6);
      // Between two pecks the tool leaves the hole straight up (no XY move below the top).
      for (const { i } of plunges.slice(1)) {
        const prev = moves[i - 1] as GcodeMove;
        expect(prev.to.z).toBeGreaterThan(0);
        expect(at(prev, c)).toBe(true);
      }
    }
  });
});
