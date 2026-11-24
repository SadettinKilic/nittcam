/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandStack } from '../commands';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Placement, type Project } from '../schema';
import { lockedPlacementInvalid, validateProject } from '../validate';
import { nestProject } from './nest';
import { checkPlacement, findPlacement, placementIsValid, rectClearance } from './placement';

const ctx = { actor: 'user' as const, at: '2026-11-17T10:00:00Z' };

function load(json: unknown): Project {
  const r = parseProject(JSON.parse(JSON.stringify(json)));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

/**
 * A 1000 × 800 sheet, margin 10, gap 4; two rect parts a (100 × 50) and b (60 × 60). Thin skin, so
 * the stored gap and margin apply as they are (D-129 raises them only with tabs).
 */
function base(placements: Placement[]): Project {
  return load({
    schemaVersion: 1,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 1000, height: 800, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'a',
        name: 'A',
        qty: 2,
        grainLock: false,
        kind: 'rect',
        params: { w: 100, h: 50, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
      {
        id: 'b',
        name: 'B',
        qty: 1,
        grainLock: true,
        kind: 'rect',
        params: { w: 60, h: 60, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 4, margin: 10 },
    layout: { sheets: [{ placements }] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb', skin: { thickness: 0.5 } },
    settings: { dimensionMode: 'cut' },
  });
}

const pl = (
  partId: string,
  index: number,
  x: number,
  y: number,
  locked = true,
  rot: Placement['rot'] = 0,
): Placement => ({
  partId,
  index,
  x,
  y,
  rot,
  locked,
});

describe('checkPlacement / LOCKED_PLACEMENT_INVALID (D-020)', () => {
  const tool = { toolDiameter: 8 };

  it('accepts a locked part inside the usable area, spaced by tool + gap (12 mm)', () => {
    const p = base([pl('a', 0, 10, 10), pl('b', 0, 122, 10, false)]);
    expect(placementIsValid(checkPlacement(p, 0, p.layout.sheets[0]!.placements[0]!, tool))).toBe(
      true,
    );
    expect(lockedPlacementInvalid(p, tool)).toEqual([]);
  });

  it('flags the margin band, the sheet edge and too-close neighbours', () => {
    const inMargin = base([pl('a', 0, 5, 10)]);
    expect(checkPlacement(inMargin, 0, inMargin.layout.sheets[0]!.placements[0]!, tool)).toEqual({
      outsideSheet: false,
      inMargin: true,
      conflicts: [],
    });
    const outside = base([pl('a', 0, 950, 10)]);
    expect(
      checkPlacement(outside, 0, outside.layout.sheets[0]!.placements[0]!, tool).outsideSheet,
    ).toBe(true);
    const close = base([pl('a', 0, 10, 10), pl('b', 0, 121, 10, false)]);
    expect(
      checkPlacement(close, 0, close.layout.sheets[0]!.placements[0]!, tool).conflicts,
    ).toEqual([{ partId: 'b', index: 0 }]);
    const issues = lockedPlacementInvalid(close, tool);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'LOCKED_PLACEMENT_INVALID',
      severity: 'error',
      path: 'layout.sheets[0].placements[0]',
    });
  });

  it('a rotated footprint counts: 50 × 100 at rot 90', () => {
    const p = base([pl('a', 0, 10, 700, true, 90)]); // 50 wide, 100 high: top at 800 > 790
    expect(checkPlacement(p, 0, p.layout.sheets[0]!.placements[0]!, tool).inMargin).toBe(true);
  });

  it('D-129: with tabs (no skin) the margin is at least Ø + 3 and the gap at least Ø + 3.1', () => {
    const withTabs = (placements: Placement[]): Project => {
      const p = base(placements);
      const cutting = { ...p.cutting };
      delete cutting.skin;
      return { ...p, nesting: { ...p.nesting, gap: 0.1, margin: 10 }, cutting };
    };
    // margin 10 < Ø8 + 3 = 11: x = 10 lies in the effective margin band, x = 11 does not
    const inBand = withTabs([pl('a', 0, 10, 20)]);
    expect(checkPlacement(inBand, 0, inBand.layout.sheets[0]!.placements[0]!, tool).inMargin).toBe(
      true,
    );
    const clear = withTabs([pl('a', 0, 11, 20), pl('b', 0, 131, 20, false)]);
    // 131 − 111 = 20 ≥ Ø8 + 11.1 = 19.1 (gap 0.1 raised to Ø + 3.1): clear; 130 − 111 = 19 is not
    expect(
      placementIsValid(checkPlacement(clear, 0, clear.layout.sheets[0]!.placements[0]!, tool)),
    ).toBe(true);
    const close = withTabs([pl('a', 0, 11, 20), pl('b', 0, 130, 20, false)]);
    expect(
      checkPlacement(close, 0, close.layout.sheets[0]!.placements[0]!, tool).conflicts,
    ).toHaveLength(1);
  });

  it('unlocked placements are not judged, only counted as neighbours', () => {
    const p = base([pl('a', 0, 0, 0, false), pl('a', 1, 1, 1, false)]);
    expect(lockedPlacementInvalid(p, tool)).toEqual([]);
  });

  it('the tool diameter comes from the context, else 0 (gap only)', () => {
    const p = base([pl('a', 0, 10, 10), pl('b', 0, 116, 10, false)]); // 6 mm apart
    expect(
      validateProject(p)
        .filter((i) => i.code !== 'PART_NOT_IN_LAYOUT')
        .map((i) => i.code),
    ).toEqual([]);
    expect(
      validateProject(p, { toolDiameter: 8 })
        .filter((i) => i.code !== 'PART_NOT_IN_LAYOUT')
        .map((i) => i.code),
    ).toEqual(['LOCKED_PLACEMENT_INVALID']);
  });

  it('the placer output with every placement locked is valid', () => {
    const start = load(shelfSet);
    const layout = nestProject(start, { toolDiameter: 8 }).layout;
    const locked = {
      ...start,
      layout: {
        sheets: layout.sheets.map((s) => ({
          placements: s.placements.map((q) => ({ ...q, locked: true })),
        })),
      },
    };
    expect(lockedPlacementInvalid(locked, { toolDiameter: 8 })).toEqual([]);
  });

  /**
   * Independent check: grow both rectangles by half the spacing and test whether the open
   * rectangles intersect (written without rectClearance). With integer coordinates there are no
   * EPS edge cases, so both must agree exactly.
   */
  function independent(p: Project, sheet: number, cand: Placement, toolDiameter: number) {
    const dims = (q: Placement) => {
      const part = p.parts.find((x) => x.id === q.partId)!;
      const { w, h } = part.kind === 'rect' ? part.params : { w: 0, h: 0 };
      return q.rot % 180 === 0 ? { w, h } : { w: h, h: w };
    };
    const half = (toolDiameter + p.nesting.gap) / 2;
    const c = dims(cand);
    const { width, height } = p.stock.sheet;
    const m = p.nesting.margin;
    const off = cand.x < 0 || cand.y < 0 || cand.x + c.w > width || cand.y + c.h > height;
    const margin =
      !off && (cand.x < m || cand.y < m || cand.x + c.w > width - m || cand.y + c.h > height - m);
    const hits = (p.layout.sheets[sheet]?.placements ?? [])
      .filter((q) => !(q.partId === cand.partId && q.index === cand.index))
      .filter((q) => {
        const d = dims(q);
        const ax1 = cand.x - half,
          ax2 = cand.x + c.w + half,
          bx1 = q.x - half,
          bx2 = q.x + d.w + half;
        const ay1 = cand.y - half,
          ay2 = cand.y + c.h + half,
          by1 = q.y - half,
          by2 = q.y + d.h + half;
        return ax1 < bx2 && bx1 < ax2 && ay1 < by2 && by1 < ay2;
      })
      .map((q) => ({ partId: q.partId, index: q.index }));
    return { outsideSheet: off, inMargin: margin, conflicts: hits };
  }

  const placementArb = (partId: string, index: number) =>
    fc.record({
      partId: fc.constant(partId),
      index: fc.constant(index),
      x: fc.integer({ min: -60, max: 1010 }),
      y: fc.integer({ min: -60, max: 810 }),
      rot: fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
      locked: fc.boolean(),
    });

  it('property: agrees with an independent inflated-overlap check', () => {
    fc.assert(
      fc.property(
        placementArb('a', 0),
        placementArb('a', 1),
        placementArb('b', 0),
        fc.constantFrom(0, 3, 6, 8, 12),
        (p1, p2, p3, toolDiameter) => {
          const p = base([p1, p2, p3]);
          for (const cand of [p1, p2, p3]) {
            expect(checkPlacement(p, 0, cand, { toolDiameter })).toEqual(
              independent(p, 0, cand, toolDiameter),
            );
          }
          // The rule reports exactly the locked placements the independent check finds invalid.
          const expected = [p1, p2, p3]
            .map((q, i) => ({ q, i }))
            .filter(({ q }) => {
              const c = independent(p, 0, q, toolDiameter);
              return q.locked && (c.outsideSheet || c.inMargin || c.conflicts.length > 0);
            })
            .map(({ i }) => `layout.sheets[0].placements[${i}]`);
          expect(lockedPlacementInvalid(p, { toolDiameter }).map((i) => i.path)).toEqual(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('rectClearance: negative inside, 0 touching, distance along the farther axis', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectClearance(r, { x: 5, y: 5, w: 10, h: 10 })).toBe(-5);
    expect(rectClearance(r, { x: 10, y: 0, w: 5, h: 5 })).toBe(0);
    expect(rectClearance(r, { x: 13, y: 15, w: 5, h: 5 })).toBe(5);
  });
});

describe('lockPlacement command', () => {
  it('moves and locks a copy in one undo step; undo restores it byte for byte', () => {
    const start = load(cabinetDoors);
    const json = JSON.stringify(start);
    const stack = new CommandStack(start, { toolDiameter: 8 });
    const r = stack.execute(
      'lockPlacement',
      { partId: 'door-left', index: 1, x: 500, y: 800 },
      ctx,
    );
    expect(r.ok && r.changed).toBe(true);
    expect(findPlacement(stack.project, { partId: 'door-left', index: 1 })?.placement).toEqual({
      partId: 'door-left',
      index: 1,
      x: 500,
      y: 800,
      rot: 0,
      locked: true,
    });
    expect(stack.log.at(-1)).toEqual({
      command: 'lockPlacement',
      params: { partId: 'door-left', index: 1, x: 500, y: 800, locked: true },
      ...ctx,
    });
    expect(stack.undo()).toBe(true);
    expect(JSON.stringify(stack.project)).toBe(json);
    expect(stack.canUndo).toBe(false);
  });

  it('toggles the lock in place; an unchanged call records nothing', () => {
    const stack = new CommandStack(load(cabinetDoors));
    expect(stack.execute('lockPlacement', { partId: 'door-right', index: 0 }, ctx)).toMatchObject({
      ok: true,
      changed: false,
    });
    const r = stack.execute(
      'lockPlacement',
      { partId: 'door-right', index: 0, locked: false },
      ctx,
    );
    expect(r.ok && r.changed).toBe(true);
    expect(findPlacement(stack.project, { partId: 'door-right', index: 0 })?.placement.locked).toBe(
      false,
    );
  });

  it('rejects unplaced copies, half a position and bad rotations', () => {
    const p = load(cabinetDoors);
    expect(applyCommand(p, 'lockPlacement', { partId: 'door-left', index: 5 })).toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED' },
    });
    expect(applyCommand(p, 'lockPlacement', { partId: 'door-left', index: 0, x: 3 })).toMatchObject(
      {
        ok: false,
        error: { code: 'INVALID_PARAMS' },
      },
    );
    expect(
      applyCommand(p, 'lockPlacement', { partId: 'door-left', index: 0, rot: 400 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PARAMS' },
    });
    // v2 (D-034): 45° is a valid number but not an allowed rotation for this part.
    expect(
      applyCommand(p, 'lockPlacement', { partId: 'door-left', index: 0, rot: 45 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED' },
    });
  });

  it('an invalid drop is accepted by the command but reported by the rule; re-nesting keeps it', () => {
    const stack = new CommandStack(load(cabinetDoors), { toolDiameter: 8 });
    stack.execute('lockPlacement', { partId: 'door-left', index: 0, x: 0, y: 0 }, ctx);
    expect(stack.issues.map((i) => i.code)).toContain('LOCKED_PLACEMENT_INVALID');
    stack.execute('lockPlacement', { partId: 'door-left', index: 0, x: 1500, y: 1000 }, ctx);
    expect(stack.issues).toEqual([]);
    stack.execute('runNesting', { toolDiameter: 8 }, ctx);
    expect(
      findPlacement(stack.project, { partId: 'door-left', index: 0 })?.placement,
    ).toMatchObject({
      x: 1500,
      y: 1000,
      locked: true,
    });
    expect(stack.issues).toEqual([]);
  });
});

describe('checkPlacement with true-shape footprints (T165)', () => {
  it('re-checks bbox conflicts on the real footprints only for true-shape layouts', () => {
    // Diagonal neighbours: 8 mm apart on each axis (Chebyshev 8 < 10), 11.3 mm apart in fact.
    const p = base([pl('a', 0, 10, 10), pl('b', 0, 118, 68)]);
    const cand = p.layout.sheets[0]!.placements[1]!;
    expect(checkPlacement(p, 0, cand, { toolDiameter: 6 }).conflicts).toHaveLength(1);
    expect(checkPlacement(p, 0, cand, { toolDiameter: 6, trueShape: true }).conflicts).toEqual([]);
    const close = base([pl('a', 0, 10, 10), pl('b', 0, 115, 65)]); // 5·√2 ≈ 7.1 < 10
    const c2 = close.layout.sheets[0]!.placements[1]!;
    expect(
      checkPlacement(close, 0, c2, { toolDiameter: 6, trueShape: true }).conflicts,
    ).toHaveLength(1);
  });
});
