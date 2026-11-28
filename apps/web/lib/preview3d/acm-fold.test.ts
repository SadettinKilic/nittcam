import { traitsOf, type Part } from '@nittcam/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bendOf,
  flatFlange90,
  foldCheck,
  foldedMesh,
  foldPlan,
  foldTransforms,
  outerFlange90,
  type FoldTool,
} from './acm-fold';

// T391: an ACM tray, 400 × 300 between the groove centres, 30 mm flat flanges, 4 mm, 0,8 left.
const traits = traitsOf('acm').vGroove as NonNullable<ReturnType<typeof traitsOf>['vGroove']>;
const TOOL: FoldTool = { angleDeg: 90, tipDiameter: 0.2, traits, face: 'back' };
const T = 4;
const XL = 30;
const XR = 430;
const YB = 30;
const YT = 330;

const v = (x: number, y: number) => ({ x, y, bulge: 0 });
const groove = (a: [number, number], b: [number, number]) => ({
  vertices: [v(...a), v(...b)],
  op: { kind: 'vgroove' },
});

/** The tray; `e` = how far the corner relief reaches past the cross groove (null = no relief). */
function tray(e: number | null): Part {
  const outline =
    e === null
      ? [v(0, 0), v(460, 0), v(460, 360), v(0, 360)]
      : [
          v(XL + e, 0),
          v(XR - e, 0),
          v(XR - e, YB),
          v(460, YB),
          v(460, YT),
          v(XR - e, YT),
          v(XR - e, 360),
          v(XL + e, 360),
          v(XL + e, YT),
          v(0, YT),
          v(0, YB),
          v(XL + e, YB),
        ];
  const k = e ?? -XL;
  return {
    id: 'tray',
    name: 'Tava',
    qty: 1,
    kind: 'freeform',
    outline,
    grain: { mode: 'free', angle: 0 },
    inners: [],
    holes: [{ type: 'through', cx: 230, cy: 180, d: 8 }],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    lines: [
      groove([XL + k, YB], [XR - k, YB]),
      groove([XR, YB], [XR, YT]),
      groove([XR - k, YT], [XL + k, YT]),
      groove([XL, YT], [XL, YB]),
    ],
  } as unknown as Part;
}

function folded(part: Part, deg: number) {
  const plan = foldPlan(part, traits);
  const angles = plan.hinges.map(() => deg);
  const rigid = foldTransforms(
    plan,
    T,
    TOOL,
    angles,
    plan.hinges.map(() => 90),
  );
  return { plan, rigid, check: foldCheck(plan, T, rigid), mesh: foldedMesh(part, plan, T, rigid) };
}

function bounds(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, p[i + k] as number);
      max[k] = Math.max(max[k] as number, p[i + k] as number);
    }
  return { min, max };
}

describe('bend model (T391)', () => {
  it('90° V, 0,2 tip, 0,8 left, 90° fold: r_i 0, r_o 0,8, BA = π/2 · 0,4', () => {
    const b = bendOf(0.8, TOOL, 90);
    expect(b.rNeutral).toBe(0.4);
    expect(b.rInner).toBe(0);
    expect(b.rOuter).toBe(0.8);
    expect(b.allowance).toBeCloseTo((Math.PI / 2) * 0.4, 3);
    expect(b.overFold).toBe(false);
  });
  it('a wide flat (3 mm) bends on its own arc: r_n = b / θ', () => {
    const b = bendOf(0.8, { angleDeg: 90, tipDiameter: 3 }, 90);
    expect(b.rNeutral).toBeCloseTo(3 / (Math.PI / 2), 3);
    expect(b.allowance).toBeCloseTo(3, 3);
  });
  it('folding past the V angle crushes the walls', () => {
    expect(bendOf(0.8, { angleDeg: 90, tipDiameter: 0 }, 120).overFold).toBe(true);
    expect(bendOf(0.8, { angleDeg: 135, tipDiameter: 0 }, 120).overFold).toBe(false);
  });
  it('flat and outer flange lengths are inverse', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5, max: 200, noNaN: true }),
        fc.double({ min: 0.3, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (flat, s, tip) => {
          const b = bendOf(s, { angleDeg: 90, tipDiameter: tip }, 90);
          return Math.abs(flatFlange90(outerFlange90(flat, b), b) - flat) < 1e-3;
        },
      ),
    );
  });
});

describe('fold plan and folded tray (T391)', () => {
  it('a 4-flange tray: one base and four flanges hanging on it', () => {
    const plan = foldPlan(tray(T), traits);
    expect(plan.hinges).toHaveLength(4);
    expect(plan.skipped).toBe(0);
    expect(plan.hinges.every((h) => h.parent === -1)).toBe(true);
    expect(plan.pieces.map((p) => p.hinge).sort()).toEqual([-1, 0, 1, 2, 3]);
  });

  it('flat (0°): the mesh is the flat part, nothing clashes', () => {
    const { mesh, check } = folded(tray(T), 0);
    const b = bounds(mesh.positions);
    expect(b.min.map((x) => Math.round(x * 1e3) / 1e3)).toEqual([0, 0, 0]);
    expect(b.max.map((x) => Math.round(x * 1e3) / 1e3)).toEqual([460, 360, T]);
    expect(check.state).not.toBe('clash');
  });

  it('90°: outer size = between grooves + 2 (r_o − BA/2), flange height = flat + r_o − BA/2', () => {
    const { mesh } = folded(tray(T), 90);
    const bend = bendOf(0.8, TOOL, 90);
    const out = bend.rOuter - bend.allowance / 2;
    const b = bounds(mesh.positions);
    expect(b.min[0]).toBeCloseTo(XL - out, 2);
    expect(b.max[0]).toBeCloseTo(XR + out, 2);
    expect(b.min[1]).toBeCloseTo(YB - out, 2);
    expect(b.max[1]).toBeCloseTo(YT + out, 2);
    expect(T - (b.min[2] as number)).toBeCloseTo(outerFlange90(30, bend), 2);
    // The base keeps its hole.
    expect(mesh.throughOpenings).toBe(1);
  });

  it('with corner reliefs one thickness long the tray closes: corner gaps below 1 mm, no overlap', () => {
    const { check } = folded(tray(T), 90);
    expect(check.state).toBe('closed');
    const corners = check.issues.filter((i) => i.kind === 'corner');
    expect(corners).toHaveLength(4);
    const bend = bendOf(0.8, TOOL, 90);
    for (const c of corners)
      if (c.kind === 'corner') expect(c.gap).toBeCloseTo(bend.rOuter - bend.allowance / 2, 2);
  });

  it('reliefs only to the groove crossing: the folded flanges overlap at every corner (red)', () => {
    const { check } = folded(tray(0), 90);
    expect(check.state).toBe('clash');
    expect(check.issues.filter((i) => i.kind === 'overlap')).toHaveLength(4);
  });

  it('no corner relief at all: flanges share the corner material', () => {
    const { check } = folded(tray(null), 45);
    expect(check.issues.filter((i) => i.kind === 'relief')).toHaveLength(4);
    expect(check.state).toBe('clash');
  });

  it('a wide relief leaves a corner gap above 1 mm', () => {
    expect(folded(tray(8), 90).check.state).toBe('gap');
  });

  it('a lip on a flange folds with its parent', () => {
    const part = {
      ...tray(T),
      lines: [groove([0, 100], [460, 100]), groove([0, 40], [460, 40])],
      outline: [v(0, 0), v(460, 0), v(460, 360), v(0, 360)],
    } as unknown as Part;
    const plan = foldPlan(part, traits);
    const lip = plan.hinges.findIndex((h) => h.a.y === 40);
    const flange = plan.hinges.findIndex((h) => h.a.y === 100);
    expect(plan.hinges[lip]?.parent).toBe(flange);
    expect(plan.pieces).toHaveLength(3);
    const rigid = foldTransforms(plan, T, TOOL, [90, 90], [90, 90]);
    const b = bounds(foldedMesh(part, plan, T, rigid).positions);
    // The flange hangs down 60 mm, the lip turns back under the base.
    expect(b.min[2]).toBeLessThan(-50);
    expect(b.min[1]).toBeGreaterThan(90);
  });

  it('curved and closed grooves are skipped', () => {
    const part = {
      ...tray(T),
      lines: [
        { vertices: [v(0, 100), v(200, 120), v(460, 100)], op: { kind: 'vgroove' } },
        groove([XL, YT], [XL, YB]),
      ],
    } as unknown as Part;
    const plan = foldPlan(part, traits);
    expect(plan.skipped).toBe(1);
    expect(plan.hinges).toHaveLength(1);
  });
});
