/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Hand-computed toolpath tests (spec §6.3, T014, D-021).
 */
import { describe, expect, it } from 'vitest';
import { bbox, contour, orientation, signedArea } from '../geometry/polyline';
import { sweepToBulge } from '../geometry/segment';
import { parseProject, type Project } from '../schema';
import { buildToolpath, innerContourPath, outerContourPath, placedOutline } from './build';
import { passDepths, throughCutTarget } from './depth';
import { operationMoves, toolpathSafetyViolations } from './safety';
import {
  clone,
  machineOf,
  passLoop,
  projectOf,
  toolpathViolations,
  type ProjectSpec,
} from './toolpath.testing';
import type { ArcMove, Move, ToolpathResult } from './types';

const Q = sweepToBulge(Math.PI / 2);

/** 100 × 50 at (100, 100) on a 2440 × 1220 sheet; tool 6, 18 mm + 0.3 spoilboard, 6.1 passes. */
function handExample(over: Partial<ProjectSpec> = {}) {
  const project = projectOf({
    parts: [{ id: 'a', w: 100, h: 50 }],
    placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    ...over,
  });
  const machine = machineOf({ toolDiameter: 6, spoilboard: 0.3, passDepth: 6.1, thickness: 18 });
  return { project, machine };
}

const handCheck = {
  passDepth: 6.1,
  thickness: 18,
  spoilboard: 0.3,
  toolDiameter: 6,
  safeZ: 20,
  plungeFeed: 1500,
};

function codes(r: ToolpathResult, kind: 'errors' | 'warnings'): string[] {
  return r[kind].map((i) => i.code);
}

/**
 * Warnings without SMALL_PART_AUTO_TABS (T015): the small parts of these T014 cases now get tabs
 * automatically; that warning is tested in tabs.test.ts.
 */
function t014(ws: ToolpathResult['warnings']): ToolpathResult['warnings'] {
  return ws.filter((w) => w.code !== 'SMALL_PART_AUTO_TABS');
}

describe('depth', () => {
  it('through-cut target = −(thickness + spoilboard allowance)', () => {
    expect(throughCutTarget(18, 0.3)).toBeCloseTo(-18.3, 12);
    expect(throughCutTarget(18, 0)).toBe(-18);
  });
  it('18.3 mm in 6.1 mm passes is 3 passes at −6.1, −12.2, −18.3 (not 4 by float rounding)', () => {
    const d = passDepths(-18.3, 6.1);
    expect(d).toHaveLength(3);
    expect(d[0]).toBeCloseTo(-6.1, 12);
    expect(d[1]).toBeCloseTo(-12.2, 12);
    expect(d[2]).toBe(-18.3);
  });
  it('equal passes, never deeper than the pass depth, last exactly the target', () => {
    expect(passDepths(-18.5, 6)).toEqual([-4.625, -9.25, -13.875, -18.5]);
    expect(passDepths(-18, 6)).toEqual([-6, -12, -18]);
    expect(passDepths(-5, 6)).toEqual([-5]);
  });
  it('rejects a non-negative target or a non-positive pass depth', () => {
    expect(() => passDepths(0, 6)).toThrow(RangeError);
    expect(() => passDepths(-18, 0)).toThrow(RangeError);
    expect(() => passDepths(-18, Number.NaN)).toThrow(RangeError);
  });
});

describe('hand-computed example: 100 × 50, tool 6, 18 + 0.3, pass 6.1', () => {
  const { project, machine } = handExample();
  const res = buildToolpath(project, machine);
  const op = res.toolpath.operations[0]!;

  it('is ok, one operation with tool, rpm and feeds from the material set', () => {
    expect(res.errors).toEqual([]);
    expect(t014(res.warnings)).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.toolpath.operations).toHaveLength(1);
    expect(op).toMatchObject({
      tool: 1,
      toolDiameter: 6,
      rpm: 18000,
      feed: 6000,
      plungeFeed: 1500,
    });
    expect(res.toolpath).toMatchObject({ units: 'mm', frame: 'sheet', safeZ: 20, clearanceZ: 2 });
    expect(res.toolpath.targetDepth).toBeCloseTo(-18.3, 12);
  });

  it('3 passes at −6.1, −12.2, −18.3; the final pass is a separate segment (tab hook)', () => {
    expect(op.passDepths).toHaveLength(3);
    expect(op.passDepths[0]).toBeCloseTo(-6.1, 12);
    expect(op.passDepths[1]).toBeCloseTo(-12.2, 12);
    expect(op.passDepths[2]).toBe(-18.3);
    const passes = op.segments.filter((s) => s.role === 'pass');
    expect(passes.map((s) => s.final)).toEqual([false, false, true]);
    expect(op.segments.map((s) => s.role)).toEqual([
      'approach',
      'leadIn',
      'pass',
      'pass',
      'pass',
      'leadOut',
      'retract',
    ]);
  });

  it('the path is a 106 × 56 rounded rectangle with corner radius 3 around the part', () => {
    for (let i = 0; i < 3; i++) {
      const loop = passLoop(op, i);
      const box = bbox(loop);
      expect(box.minX).toBeCloseTo(97, 9);
      expect(box.minY).toBeCloseTo(97, 9);
      expect(box.maxX).toBeCloseTo(203, 9);
      expect(box.maxY).toBeCloseTo(153, 9);
      // area of a 106 × 56 rectangle with r = 3 corners: 106·56 − (4 − π)·9
      expect(Math.abs(signedArea(loop))).toBeCloseTo(106 * 56 - (4 - Math.PI) * 9, 6);
    }
    const arcs = op.segments
      .find((s) => s.final)!
      .moves.filter((m): m is ArcMove => m.kind === 'arc');
    expect(arcs).toHaveLength(4);
    const centres = arcs.map((a) => `${Math.round(a.cx)},${Math.round(a.cy)}`).sort();
    expect(centres).toEqual(['100,100', '100,150', '200,100', '200,150']);
    for (const a of arcs) {
      expect(Math.hypot(a.x - a.cx, a.y - a.cy)).toBeCloseTo(3, 9);
      expect(a.direction).toBe('cw'); // climb = CW travel
    }
  });

  it('approach: rapid at safe Z above the lead start, rapid to 2 mm, plunge at plunge feed', () => {
    const [a, b, c] = op.segments[0]!.moves as [Move, Move, Move];
    expect(a).toMatchObject({ kind: 'rapid', z: 20 });
    expect(b).toMatchObject({ kind: 'rapid', x: a.x, y: a.y, z: 2 });
    expect(c).toMatchObject({ kind: 'plunge', x: a.x, y: a.y, feed: 1500 });
    expect(c.z).toBeCloseTo(-6.1, 12);
    // start on the middle of a long edge, lead start 3 mm out and 3 mm back along the edge
    const start = op.segments[1]!.moves[0]!;
    expect(start.x).toBeCloseTo(150, 9);
    expect([97, 153].some((y) => Math.abs(start.y - y) < 1e-9)).toBe(true);
    expect(Math.abs(a.x - 150)).toBeCloseTo(3, 9);
    expect(Math.min(Math.abs(a.y - 94), Math.abs(a.y - 156))).toBeCloseTo(0, 9);
    const last = op.segments.at(-1)!.moves.at(-1)!;
    expect(last).toMatchObject({ kind: 'rapid', z: 20 });
  });

  it('satisfies every invariant of the independent checker', () => {
    expect(toolpathViolations(project, res, { ...handCheck, direction: 'climb' })).toEqual([]);
    expect(toolpathSafetyViolations(res.toolpath)).toEqual([]);
  });

  it('summary stats are in the right order of magnitude', () => {
    // 3 loops of 2·100 + 2·50 + 2π·3 ≈ 318.85, plus leads and plunges ≈ 30 mm
    const loop = 300 + 6 * Math.PI;
    expect(res.summary.cutLength).toBeGreaterThan(3 * loop);
    expect(res.summary.cutLength).toBeLessThan(3 * loop + 60);
    expect(res.summary.rapidLength).toBeGreaterThan(18);
    expect(res.summary.rapidLength).toBeLessThan(60);
    // ≈ 960 mm at 6000 mm/min ≈ 9.6 s, plus plunges at 1500
    expect(res.summary.estimatedSeconds).toBeGreaterThan(9);
    expect(res.summary.estimatedSeconds).toBeLessThan(15);
    expect(res.summary.operationCount).toBe(1);
  });
});

describe('direction, leads and plunge options', () => {
  const { project, machine } = handExample();

  it('climb travels CW, conventional CCW (outer contour, CW spindle)', () => {
    const climb = buildToolpath(project, machine, { direction: 'climb' }).toolpath.operations[0]!;
    const conv = buildToolpath(project, machine, { direction: 'conventional' }).toolpath
      .operations[0]!;
    expect(climb.travel).toBe('cw');
    expect(conv.travel).toBe('ccw');
    expect(orientation(passLoop(climb, 2))).toBe('cw');
    expect(orientation(passLoop(conv, 2))).toBe('ccw');
    const res = buildToolpath(project, machine, { direction: 'conventional' });
    expect(toolpathViolations(project, res, { ...handCheck, direction: 'conventional' })).toEqual(
      [],
    );
  });

  it('the project setting is the default direction and lead type', () => {
    const p = projectOf({
      parts: [{ id: 'a', w: 100, h: 50 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
      direction: 'conventional',
      leadIn: 'line',
    });
    const op = buildToolpath(p, machine).toolpath.operations[0]!;
    expect(op.travel).toBe('ccw');
    expect(op.segments.find((s) => s.role === 'leadIn')!.moves[0]!.kind).toBe('linear');
  });

  it('line lead: 45° line of the lead length, outside the part', () => {
    const res = buildToolpath(project, machine, { lead: 'line', leadLength: 4 });
    const op = res.toolpath.operations[0]!;
    const entry = op.segments[0]!.moves[0]!;
    const p = op.segments[1]!.moves[0]!;
    expect(Math.hypot(entry.x - p.x, entry.y - p.y)).toBeCloseTo(4, 9);
    expect(Math.abs(entry.x - p.x)).toBeCloseTo(4 / Math.SQRT2, 9);
    expect(toolpathViolations(project, res, { ...handCheck, direction: 'climb' })).toEqual([]);
  });

  it('no lead: plunge on the contour start, no lead segments', () => {
    const res = buildToolpath(project, machine, { lead: 'none' });
    const op = res.toolpath.operations[0]!;
    expect(op.segments.map((s) => s.role)).toEqual(['approach', 'pass', 'pass', 'pass', 'retract']);
    expect(t014(res.warnings)).toEqual([]);
    expect(toolpathViolations(project, res, { ...handCheck, direction: 'climb' })).toEqual([]);
  });

  it('ramp: zig-zag along the contour at the plunge feed, angle as configured', () => {
    const res = buildToolpath(project, machine, { plunge: { type: 'ramp', angleDeg: 5 } });
    expect(res.ok).toBe(true);
    const op = res.toolpath.operations[0]!;
    expect(op.segments[0]!.moves.at(-1)).toMatchObject({ kind: 'plunge', z: 0, feed: 1500 });
    const pass0 = op.segments.find((s) => s.pass === 0)!;
    const descending = pass0.moves.filter((m) => m.z < -1e-9 && m.z > -6.1 + 1e-9);
    expect(descending.length).toBeGreaterThan(0);
    for (const m of descending) expect((m as { feed: number }).feed).toBe(1500);
    // each leg descends 6.1 / 2 over 3.05 / tan 5° mm
    const leg = 3.05 / Math.tan((5 * Math.PI) / 180);
    const moves = operationMoves(op);
    let prev = moves[0]!;
    let rampXY = 0;
    for (const m of moves.slice(1)) {
      if (
        m.kind !== 'rapid' &&
        m.kind !== 'plunge' &&
        m.z < prev.z - 1e-12 &&
        prev.z <= 0 &&
        m.z >= -6.1 - 1e-9
      ) {
        rampXY += Math.hypot(m.x - prev.x, m.y - prev.y); // straight edge: chord = length
      }
      prev = m;
    }
    expect(rampXY).toBeCloseTo(2 * leg, 6);
    expect(toolpathViolations(project, res, { ...handCheck, direction: 'climb' })).toEqual([]);
  });

  it('ramp longer than the contour is clamped with a RAMP_STEEPER warning', () => {
    // T015: the ramp now covers the whole loop, so the small 100 × 50 part has no room for tabs:
    // SMALL_PART_UNSECURED (export-blocking, D-022). With the small-part rule off it is ok.
    const blocked = buildToolpath(project, machine, { plunge: { type: 'ramp', length: 5000 } });
    expect(codes(blocked, 'warnings')).toContain('RAMP_STEEPER');
    expect(codes(blocked, 'errors')).toEqual(['SMALL_PART_UNSECURED']);
    const res = buildToolpath(project, machine, {
      plunge: { type: 'ramp', length: 5000 },
      tabs: { smallPartArea: 0, smallPartMinSide: 0 },
    });
    expect(res.ok).toBe(true);
    expect(codes(res, 'warnings')).toContain('RAMP_STEEPER');
    expect(toolpathViolations(project, res, { ...handCheck, direction: 'climb' })).toEqual([]);
  });

  it('a lead that would touch a neighbour is shortened, or removed when nothing fits', () => {
    // a between b (above) and c (below), 8 mm apart = tool 6 + gap 2
    const sandwich = (gap: number) =>
      projectOf({
        parts: [
          { id: 'a', w: 100, h: 50 },
          { id: 'b', w: 100, h: 50 },
          { id: 'c', w: 100, h: 50 },
        ],
        gap,
        placements: [
          [
            { partId: 'a', index: 0, x: 100, y: 200, rot: 0 },
            { partId: 'b', index: 0, x: 100, y: 250 + 6 + gap, rot: 0 },
            { partId: 'c', index: 0, x: 100, y: 200 - 50 - 6 - gap, rot: 0 },
          ],
        ],
      });
    const shortened = buildToolpath(sandwich(2), machine, { leadLength: 3 });
    expect(shortened.ok).toBe(true);
    expect(
      t014(shortened.warnings)
        .filter((w) => w.partId === 'a')
        .map((w) => w.code),
    ).toEqual(['LEAD_SHORTENED']);
    expect(
      toolpathViolations(sandwich(2), shortened, { ...handCheck, direction: 'climb' }),
    ).toEqual([]);

    const removed = buildToolpath(sandwich(0), machine, { leadLength: 3 });
    expect(removed.ok).toBe(true);
    expect(
      t014(removed.warnings)
        .filter((w) => w.partId === 'a')
        .map((w) => w.code),
    ).toEqual(['LEAD_REMOVED']);
    const a = removed.toolpath.operations.find((o) => o.partId === 'a')!;
    expect(a.segments.some((s) => s.role === 'leadIn')).toBe(false);
    expect(toolpathViolations(sandwich(0), removed, { ...handCheck, direction: 'climb' })).toEqual(
      [],
    );
  });

  it('clearance above safe Z is clamped with a warning; invalid options are errors', () => {
    const clamped = buildToolpath(project, machine, { clearance: 50 });
    expect(t014(clamped.warnings).map((w) => w.code)).toEqual(['CLEARANCE_CLAMPED']);
    expect(clamped.toolpath.clearanceZ).toBe(20);
    expect(clamped.ok).toBe(true);
    expect(toolpathSafetyViolations(clamped.toolpath)).toEqual([]);
    for (const bad of [
      { clearance: 0 },
      { leadLength: -1 },
      { plunge: { type: 'ramp' as const, angleDeg: 0 } },
      { plunge: { type: 'ramp' as const, length: -5 } },
      { rapidFeed: 0 },
      { cutting: { passDepth: 0 } },
      { cutting: { feed: Number.NaN } },
    ]) {
      const r = buildToolpath(project, machine, bad);
      expect(r.ok).toBe(false);
      expect(codes(r, 'errors')).toEqual(['INVALID_OPTION']);
      expect(r.toolpath.operations).toEqual([]);
    }
  });
});

describe('placement transform', () => {
  it('rotated placement: the outline is rotated, then its bbox minimum moved to (x, y)', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 100, h: 50 }],
      placements: [[{ partId: 'a', index: 0, x: 300, y: 200, rot: 90 }]],
    });
    const out = placedOutline(project.parts[0]!, { x: 300, y: 200, rot: 90 });
    expect(bbox(out)).toEqual({ minX: 300, minY: 200, maxX: 350, maxY: 300 });
    expect(orientation(out)).toBe('ccw');
    const res = buildToolpath(project, machineOf());
    expect(res.ok).toBe(true);
    expect(toolpathViolations(project, res, { ...handCheck, direction: 'climb' })).toEqual([]);
  });
});

describe('D-013 offset results', () => {
  it('rounded rect r = 2 with tool r = 3: the outward offset grows the convex corners to r = 5 (no collapse)', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 100, h: 50, r: 2 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    });
    const res = buildToolpath(project, machineOf({ toolDiameter: 6 }));
    expect(res.ok).toBe(true);
    expect(codes(res, 'warnings')).not.toContain('ARC_COLLAPSED');
    const arcs = res.toolpath.operations[0]!.segments.find((s) => s.final)!.moves.filter(
      (m): m is ArcMove => m.kind === 'arc',
    );
    for (const a of arcs) expect(Math.hypot(a.x - a.cx, a.y - a.cy)).toBeCloseTo(5, 9);
  });

  it('a concave corner radius 2 with tool r = 3 gives an ARC_COLLAPSED warning (still ok)', () => {
    const b = -Q; // concave quarter arc on a CCW outline
    const outline = [
      { x: 0, y: 0, bulge: 0 },
      { x: 100, y: 0, bulge: 0 },
      { x: 100, y: 30, bulge: 0 },
      { x: 52, y: 30, bulge: b },
      { x: 50, y: 32, bulge: 0 },
      { x: 50, y: 50, bulge: 0 },
      { x: 0, y: 50, bulge: 0 },
    ];
    expect(outerContourPath(contour(outline), 3).issues.map((i) => i.code)).toEqual([
      'ARC_COLLAPSED',
    ]);
    const base = projectOf({ parts: [{ id: 'a', w: 100, h: 50 }] });
    const parsed = parseProject({
      ...JSON.parse(JSON.stringify(base)),
      parts: [
        {
          id: 'l',
          name: 'L',
          qty: 1,
          grain: { mode: 'free', angle: 0 },
          kind: 'freeform',
          outline,
          inners: [],
          holes: [],
          edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
          templates: [],
        },
      ],
      layout: {
        sheets: [
          { placements: [{ partId: 'l', index: 0, x: 100, y: 100, rot: 0, locked: false }] },
        ],
      },
    });
    if (!parsed.ok) throw new Error('fixture');
    const res = buildToolpath(parsed.project, machineOf({ toolDiameter: 6 }));
    expect(res.ok).toBe(true);
    expect(t014(res.warnings)).toEqual([
      expect.objectContaining({
        code: 'ARC_COLLAPSED',
        severity: 'warning',
        partId: 'l',
        copy: 0,
        sheet: 0,
      }),
    ]);
  });

  it('inner contour hook: SPLIT (narrow neck) and a too-small opening are export-blocking errors', () => {
    const dumbbell = contour([
      { x: 10, y: 10, bulge: 0 },
      { x: 30, y: 10, bulge: 0 },
      { x: 30, y: 18, bulge: 0 },
      { x: 40, y: 18, bulge: 0 },
      { x: 40, y: 10, bulge: 0 },
      { x: 60, y: 10, bulge: 0 },
      { x: 60, y: 30, bulge: 0 },
      { x: 40, y: 30, bulge: 0 },
      { x: 40, y: 22, bulge: 0 },
      { x: 30, y: 22, bulge: 0 },
      { x: 30, y: 30, bulge: 0 },
      { x: 10, y: 30, bulge: 0 },
    ]);
    const split = innerContourPath(dumbbell, 3);
    expect(split.ok).toBe(false);
    expect(split.issues).toEqual([
      expect.objectContaining({ code: 'INNER_SPLIT', severity: 'error' }),
    ]);
    const tiny = contour([
      { x: 0, y: 0, bulge: 0 },
      { x: 4, y: 0, bulge: 0 },
      { x: 4, y: 4, bulge: 0 },
      { x: 0, y: 4, bulge: 0 },
    ]);
    const small = innerContourPath(tiny, 3);
    expect(small.ok).toBe(false);
    expect(small.issues.map((i) => i.code)).toEqual(['INNER_OFFSET_FAILED']);
    const fine = innerContourPath(
      contour([
        { x: 0, y: 0, bulge: 0 },
        { x: 40, y: 0, bulge: 0 },
        { x: 40, y: 40, bulge: 0 },
        { x: 0, y: 40, bulge: 0 },
      ]),
      3,
    );
    expect(fine.ok).toBe(true);
    expect(bbox(fine.paths[0]!)).toEqual({ minX: 3, minY: 3, maxX: 37, maxY: 37 });
  });
});

describe('project-level errors and warnings', () => {
  function withFeature(feature: 'inner' | 'hole'): Project {
    const base = JSON.parse(JSON.stringify(handExample().project));
    if (feature === 'inner') {
      base.parts[0].inners = [
        [
          { x: 30, y: 10, bulge: 0 },
          { x: 30, y: 40, bulge: 0 },
          { x: 70, y: 40, bulge: 0 },
          { x: 70, y: 10, bulge: 0 },
        ],
      ];
    } else {
      base.parts[0].holes = [{ id: 'h', type: 'through', d: 8, cx: 50, cy: 25, tool: 1 }];
    }
    const r = parseProject(base);
    if (!r.ok) throw new Error('fixture');
    return r.project;
  }

  it('holes and inner contours are cut, holes first (T134, T139)', () => {
    const machine = handExample().machine;
    const inner = buildToolpath(withFeature('inner'), machine);
    expect(codes(inner, 'errors')).toEqual([]);
    expect(inner.toolpath.operations.map((o) => o.kind)).toEqual(['innerContour', 'outerContour']);
    const hole = buildToolpath(withFeature('hole'), machine);
    expect(codes(hole, 'errors')).toEqual([]);
    expect(hole.ok).toBe(true);
    const kinds = hole.toolpath.operations.map((o) => o.kind);
    expect(kinds.slice(0, 2)).toEqual(['pocket', 'outerContour']);
  });

  it('missing cutting parameters, unknown tool, too short flutes', () => {
    const { project } = handExample();
    const plywood = parseProject({
      ...JSON.parse(JSON.stringify(project)),
      stock: { ...project.stock, material: 'plywood' },
    });
    if (!plywood.ok) throw new Error('fixture');
    const machine = machineOf();
    const none = buildToolpath(plywood.project, machine);
    expect(codes(none, 'errors')).toEqual(['NO_CUTTING_PARAMS']);
    expect(none.ok).toBe(false);
    const overridden = buildToolpath(plywood.project, machine, {
      cutting: { tool: 1, feed: 5000, plungeFeed: 1000, rpm: 16000, passDepth: 6.1 },
    });
    expect(overridden.ok).toBe(true);
    expect(overridden.toolpath.operations[0]).toMatchObject({
      feed: 5000,
      plungeFeed: 1000,
      rpm: 16000,
    });

    expect(codes(buildToolpath(project, machine, { cutting: { tool: 9 } }), 'errors')).toEqual([
      'TOOL_NOT_IN_PROFILE',
    ]);
    const short = buildToolpath(project, machineOf({ fluteLength: 15 }));
    expect(codes(short, 'errors')).toEqual(['DEPTH_EXCEEDS_FLUTE_LENGTH']);
  });

  it('unplaced copies are a warning; nothing placed is an error', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 100, h: 50, qty: 2 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    });
    const res = buildToolpath(project, machineOf());
    expect(res.ok).toBe(true);
    expect(t014(res.warnings).map((w) => w.code)).toEqual(['UNPLACED_COPIES']);
    const empty = buildToolpath(projectOf({ parts: [{ id: 'a', w: 100, h: 50 }] }), machineOf());
    expect(empty.ok).toBe(false);
    expect(codes(empty, 'errors')).toEqual(['NO_PLACEMENTS']);
  });

  it('operations are ordered by sheet, then placement order', () => {
    const project = projectOf({
      parts: [
        { id: 'a', w: 100, h: 50 },
        { id: 'b', w: 80, h: 40, qty: 2 },
      ],
      placements: [
        [
          { partId: 'b', index: 1, x: 500, y: 100, rot: 0 },
          { partId: 'a', index: 0, x: 100, y: 100, rot: 0 },
        ],
        [{ partId: 'b', index: 0, x: 100, y: 100, rot: 90 }],
      ],
    });
    const res = buildToolpath(project, machineOf());
    expect(res.toolpath.operations.map((o) => `${o.sheet}:${o.id}`)).toEqual([
      '0:b#1',
      '0:a#0',
      '1:b#0',
    ]);
  });
});

describe('defence in depth: the safety checker catches broken toolpaths', () => {
  const { project, machine } = handExample();
  const fresh = () => clone(buildToolpath(project, machine).toolpath);

  it('XY rapid below safe Z', () => {
    const tp = fresh();
    tp.operations[0]!.segments[0]!.moves[0]!.z = 5;
    expect(toolpathSafetyViolations(tp).join()).toMatch(/safe Z/);
  });
  it('rapid into the material', () => {
    const tp = fresh();
    tp.operations[0]!.segments[0]!.moves[1]!.z = -1;
    expect(toolpathSafetyViolations(tp).join()).toMatch(/clearance/);
  });
  it('plunge at the cutting feed', () => {
    const tp = fresh();
    (tp.operations[0]!.segments[0]!.moves[2] as { feed: number }).feed = 6000;
    expect(toolpathSafetyViolations(tp).join()).toMatch(/plunge feed/);
  });
  it('a move below the target depth', () => {
    const tp = fresh();
    tp.operations[0]!.segments[2]!.moves[0]!.z = -19;
    expect(toolpathSafetyViolations(tp).join()).toMatch(/below the target/);
  });
  it('not ending at safe Z, non-finite numbers, bad arcs', () => {
    const tp = fresh();
    tp.operations[0]!.segments.at(-1)!.moves[0]!.z = 10;
    expect(toolpathSafetyViolations(tp).join()).toMatch(/end at safe Z/);
    const tp2 = fresh();
    tp2.operations[0]!.segments[2]!.moves[0]!.x = Number.NaN;
    expect(toolpathSafetyViolations(tp2).join()).toMatch(/non-finite/);
    const tp3 = fresh();
    const arc = tp3.operations[0]!.segments[2]!.moves.find((m) => m.kind === 'arc') as ArcMove;
    arc.cx += 1;
    expect(toolpathSafetyViolations(tp3).join()).toMatch(/circle/);
  });
});
