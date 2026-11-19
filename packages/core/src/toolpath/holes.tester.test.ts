/**
 * Tester edge cases for B14 holes (T138–T140, D-050): rotated parts keep their holes in place
 * (against the existing cut-out transform), holes at the limits (near the edge, d = tool, groove
 * width = tool, wide grooves, near-thickness blind depth) go through toolpath → post → check, and
 * the refusals stop the job.
 */
import { describe, expect, it } from 'vitest';
import { checkGcode } from '../gcode-check/check';
import { postConfig } from '../gcode-check/check.testing';
import { expectedLayout } from '../gcode-check/layout';
import { readGcode } from '../gcode-reader';
import { goldenProfile, holeFixtureProject } from '../post/golden.testing';
import { run as runPost } from '../post/post.testing';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath, placedInners } from './build';
import { placedHoleCentre } from './holes';

function pipeline(holes: unknown[], mutate?: (p: ReturnType<typeof goldenProfile>) => void) {
  const profile = goldenProfile('generic');
  mutate?.(profile);
  const project = holeFixtureProject(holes);
  const tp = buildToolpath(project, profile);
  if (!tp.ok) return { tp, project, text: '', check: undefined, read: undefined };
  const config = postConfig('generic');
  const res = runPost({ toolpath: tp.toolpath, profile, config });
  expect(res.errors).toEqual([]);
  const text = res.files[0]?.content ?? '';
  const check = checkGcode(text, {
    profile,
    verification: 'draft',
    post: config,
    toolpath: tp.toolpath,
    stock: { thickness: 18, sheetWidth: 2800, sheetHeight: 2070 },
    sheet: 0,
    layout: expectedLayout(project, 0),
  });
  return { tp, project, text, check, read: readGcode(text) };
}

const errorCodes = (r: ReturnType<typeof pipeline>) => r.tp.errors.map((e) => e.code);

/** Deepest Z and the farthest tool-centre distance from `c` of the feed moves near `c`. */
function around(r: ReturnType<typeof pipeline>, c: { x: number; y: number }, within: number) {
  const ms = (r.read?.moves ?? []).filter(
    (m) => m.type !== 'rapid' && Math.hypot(m.to.x - c.x, m.to.y - c.y) < within,
  );
  return {
    zMin: Math.min(...ms.map((m) => m.to.z)),
    rMax: Math.max(...ms.map((m) => Math.hypot(m.to.x - c.x, m.to.y - c.y))),
    count: ms.length,
  };
}

function expectClean(r: ReturnType<typeof pipeline>) {
  expect(r.tp.errors).toEqual([]);
  expect(r.read?.errors).toEqual([]);
  expect(r.check?.violations.filter((v) => v.severity === 'error')).toEqual([]);
  expect(r.check?.ok).toBe(true);
}

describe('rotated parts keep their holes in place (T138 tester focus)', () => {
  // An L-shaped freeform part: a hole near the inner corner must stay there at any rotation.
  const L = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 80 },
    { x: 90, y: 80 },
    { x: 90, y: 250 },
    { x: 0, y: 250 },
  ];
  const hole = { cx: 45, cy: 200 };
  // A tiny square cut-out centred on the hole: its existing placement transform is the reference.
  const marker = [
    { x: 44, y: 199 },
    { x: 44, y: 201 },
    { x: 46, y: 201 },
    { x: 46, y: 199 },
  ];
  const part = (): Project['parts'][number] => {
    const parsed = parseProject({
      schemaVersion: 2,
      machine: { machineId: 'golden', profileVersion: 1 },
      stock: {
        material: 'mdf',
        thickness: 18,
        sheet: { width: 2800, height: 2070, grain: 0 },
        useOffcuts: false,
      },
      parts: [
        {
          id: 'L',
          name: 'L',
          qty: 1,
          grain: { mode: 'free', angle: 0 },
          kind: 'freeform',
          outline: L.map((v) => ({ ...v, bulge: 0 })),
          inners: [marker.map((v) => ({ ...v, bulge: 0 }))],
          holes: [],
          edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
          templates: [],
        },
      ],
      nesting: { mode: 'minWaste', gap: 10, margin: 12 },
      layout: { sheets: [] },
      cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return parsed.project.parts[0] as Project['parts'][number];
  };

  it.each([0, 90, 180, 270, 37.5, 123.25])('rot %s°', (rot) => {
    const p = part();
    const pl = { x: 500, y: 400, rot };
    const c = placedHoleCentre(p, pl, hole);
    const vs = placedInners(p, pl)[0]?.vertices ?? [];
    const mx = vs.reduce((s, v) => s + v.x, 0) / vs.length;
    const my = vs.reduce((s, v) => s + v.y, 0) / vs.length;
    expect(c.x).toBeCloseTo(mx, 6);
    expect(c.y).toBeCloseTo(my, 6);
  });
});

describe('holes at the limits through toolpath → post → reader → check', () => {
  it('a through hole 0.1 mm from the part edge: cut, wall exact, check clean', () => {
    const r = pipeline([{ id: 'h', type: 'through', d: 20, cx: 10.1, cy: 150, tool: 2 }]);
    expectClean(r);
    const a = around(r, { x: 110.1, y: 250 }, 9);
    expect(a.zMin).toBeCloseTo(-18.5, 3);
    expect(a.rMax + 4).toBeCloseTo(10, 3);
  });

  it('touching the edge is refused (outside)', () => {
    const r = pipeline([{ id: 'h', type: 'through', d: 20, cx: 10, cy: 150, tool: 2 }]);
    expect(errorCodes(r)).toEqual(['HOLE_OUTSIDE_PART']);
  });

  it('d = tool exactly → drill pecks only at the centre', () => {
    const r = pipeline([{ id: 'h', type: 'through', d: 8, cx: 200, cy: 150, tool: 2 }]);
    expectClean(r);
    expect(r.tp.toolpath.operations.filter((o) => o.holeId).map((o) => o.kind)).toEqual([
      'drill',
      'drill',
    ]);
    const a = around(r, { x: 300, y: 250 }, 3);
    expect(a.rMax).toBeLessThan(1e-6);
  });

  it('d a hair above the tool (wall < helix minimum): straight plunge, wall exact', () => {
    const r = pipeline([{ id: 'h', type: 'pocket', d: 8.3, depth: 10, cx: 200, cy: 150, tool: 2 }]);
    expectClean(r);
    const a = around(r, { x: 300, y: 250 }, 3);
    expect(a.zMin).toBeCloseTo(-10, 3);
    expect(a.rMax + 4).toBeCloseTo(4.15, 3);
  });

  it('groove width = tool → one ring on the centreline', () => {
    const r = pipeline([
      { id: 'h', type: 'groove', d: 60, grooveWidth: 8, depth: 3, cx: 200, cy: 150, tool: 2 },
    ]);
    expectClean(r);
    const ms = (r.read?.moves ?? []).filter(
      (m) => m.type !== 'rapid' && m.to.z < -1e-6 && Math.hypot(m.to.x - 300, m.to.y - 250) < 40,
    );
    for (const m of ms) expect(Math.hypot(m.to.x - 300, m.to.y - 250)).toBeCloseTo(30, 3);
  });

  it('a groove as wide as its diameter or wider never reaches the toolpath (schema refuses)', () => {
    for (const grooveWidth of [10, 30]) {
      expect(() =>
        holeFixtureProject([
          { id: 'h', type: 'groove', d: 10, grooveWidth, depth: 3, cx: 200, cy: 150, tool: 2 },
        ]),
      ).toThrow(/groove width must be smaller than the centreline diameter/);
    }
  });

  it('a wide groove (width 20 on Ø30): rings across the width, inner and outer edge exact', () => {
    const r = pipeline([
      { id: 'h', type: 'groove', d: 30, grooveWidth: 20, depth: 3, cx: 200, cy: 150, tool: 2 },
    ]);
    expectClean(r);
    const ms = (r.read?.moves ?? []).filter(
      (m) => m.type !== 'rapid' && m.to.z < -1e-6 && Math.hypot(m.to.x - 300, m.to.y - 250) < 30,
    );
    const rs = ms.map((m) => Math.hypot(m.to.x - 300, m.to.y - 250));
    expect(Math.min(...rs) - 4).toBeCloseTo(5, 3);
    expect(Math.max(...rs) + 4).toBeCloseTo(25, 3);
    expect(Math.min(...ms.map((m) => m.to.z))).toBeCloseTo(-3, 3);
  });

  it('blind depth 17.5 of 18: warning HOLE_DEPTH_NEAR_THICKNESS, still cut to 17.5 only', () => {
    const holes = [{ id: 'h', type: 'pocket', d: 35, depth: 17.5, cx: 200, cy: 150, tool: 2 }];
    const v = validateProject(holeFixtureProject(holes));
    expect(v.filter((i) => i.code === 'HOLE_DEPTH_NEAR_THICKNESS').map((i) => i.severity)).toEqual([
      'warning',
    ]);
    const r = pipeline(holes);
    expectClean(r);
    expect(around(r, { x: 300, y: 250 }, 15).zMin).toBeCloseTo(-17.5, 3);
  });

  it('blind depth = thickness and above: refused', () => {
    for (const depth of [18, 18.0005, 25]) {
      const r = pipeline([{ id: 'h', type: 'pocket', d: 35, depth, cx: 200, cy: 150, tool: 2 }]);
      expect(errorCodes(r)).toEqual(['HOLE_DEPTH_INVALID']);
    }
  });
});

describe('refusals stop the job (T139–T140)', () => {
  it.each([
    [
      'outside the part',
      { id: 'h', type: 'through', d: 30, cx: 390, cy: 150, tool: 2 },
      'HOLE_OUTSIDE_PART',
    ],
    [
      'smaller than the tool',
      { id: 'h', type: 'through', d: 7.9, cx: 200, cy: 150, tool: 2 },
      'HOLE_SMALLER_THAN_TOOL',
    ],
    [
      'groove narrower than the tool',
      { id: 'h', type: 'groove', d: 60, grooveWidth: 6, depth: 3, cx: 200, cy: 150, tool: 2 },
      'GROOVE_NARROWER_THAN_TOOL',
    ],
    [
      'unknown tool',
      { id: 'h', type: 'through', d: 30, cx: 200, cy: 150, tool: 9 },
      'TOOL_NOT_IN_PROFILE',
    ],
  ])('%s', (_what, hole, code) => {
    const r = pipeline([hole]);
    expect(r.tp.ok).toBe(false);
    expect(errorCodes(r)).toEqual([code]);
  });

  it('blind depth beyond the flute length', () => {
    const r = pipeline(
      [{ id: 'h', type: 'pocket', d: 35, depth: 12.5, cx: 200, cy: 150, tool: 2 }],
      (p) => {
        const t2 = p.tools.find((t) => t.number === 2);
        if (t2) t2.fluteLength = 12;
      },
    );
    expect(errorCodes(r)).toEqual(['DEPTH_EXCEEDS_FLUTE_LENGTH']);
  });

  it('blind hole outside the part after a rotated placement still refused once per part', () => {
    const r = pipeline([{ id: 'h', type: 'pocket', d: 35, depth: 5, cx: 200, cy: 290, tool: 2 }]);
    expect(errorCodes(r)).toEqual(['HOLE_OUTSIDE_PART']);
  });
});
