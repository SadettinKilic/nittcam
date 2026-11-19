/**
 * Nesting modes (T162, spec §6.2): one objective, the modes are weight presets. Each mode wins its
 * own metric on the benchmark set, the placer stays deterministic, the invariants hold with tool
 * sets, and min-waste ranks exactly as before (waste only).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { NestingMode } from '../schema';
import { BENCH_DATASETS, kitchenHardware } from './__bench__/datasets';
import { nest, PART_ORDERINGS, PLACER_HEURISTICS } from './nest';
import { invariantViolations } from './nest.testing';
import { MODE_WEIGHTS, type NestingInput, type NestPart } from './types';

const MODES: readonly NestingMode[] = ['minWaste', 'fastest', 'minToolChanges'];

describe('MODE_WEIGHTS', () => {
  it('is one objective: every mode weighs waste, each mode adds its own term', () => {
    expect(MODE_WEIGHTS.minWaste).toEqual({ waste: 1, cutLength: 0, toolChanges: 0, handling: 0 });
    expect(MODE_WEIGHTS.fastest.cutLength).toBeGreaterThan(0);
    expect(MODE_WEIGHTS.fastest.toolChanges).toBe(0);
    expect(MODE_WEIGHTS.minToolChanges.toolChanges).toBeGreaterThan(0);
    expect(MODE_WEIGHTS.minToolChanges.cutLength).toBe(0);
  });
});

describe('each mode wins its own metric on the benchmark set', () => {
  for (const { name, input } of BENCH_DATASETS) {
    it(name, () => {
      const r = Object.fromEntries(MODES.map((mode) => [mode, nest({ ...input, mode })])) as Record<
        NestingMode,
        ReturnType<typeof nest>
      >;
      // No mode opens an extra sheet or drops a copy to win its own term.
      for (const mode of MODES) {
        expect(r[mode].sheetCount).toBe(r.minWaste.sheetCount);
        expect(r[mode].unplaced).toEqual([]);
      }
      for (const other of MODES) {
        expect(r.minWaste.cost.wasteArea).toBeLessThanOrEqual(r[other].cost.wasteArea);
        expect(r.fastest.cost.cutLength).toBeLessThanOrEqual(r[other].cost.cutLength);
        expect(r.minToolChanges.cost.toolChanges).toBeLessThanOrEqual(r[other].cost.toolChanges);
      }
    });
  }

  it('the modes really differ on the hardware kitchen', () => {
    const waste = nest({ ...kitchenHardware, mode: 'minWaste' });
    const fastest = nest({ ...kitchenHardware, mode: 'fastest' });
    const tools = nest({ ...kitchenHardware, mode: 'minToolChanges' });
    expect(fastest.cost.cutLength).toBeLessThan(waste.cost.cutLength);
    expect(tools.cost.toolChanges).toBeLessThan(waste.cost.toolChanges);
  });
});

describe('objective terms', () => {
  const base: NestingInput = {
    sheet: { width: 1000, height: 1000 },
    parts: [],
    gap: 0,
    margin: 0,
    toolDiameter: 6,
    mode: 'minWaste',
    locked: [],
  };

  it('counts tool changes per sheet: distinct tools minus one', () => {
    const r = nest({
      ...base,
      contourTool: 1,
      parts: [
        { id: 'a', w: 200, h: 200, qty: 1, holeTools: [2] },
        { id: 'b', w: 200, h: 200, qty: 1, holeTools: [3, 2] },
        { id: 'c', w: 200, h: 200, qty: 1 },
      ],
    });
    expect(r.sheetCount).toBe(1);
    // Tools 1, 2, 3 on one sheet.
    expect(r.cost.toolChanges).toBe(2);
  });

  it('a hole tool equal to the contour tool is no change', () => {
    const r = nest({
      ...base,
      contourTool: 1,
      parts: [{ id: 'a', w: 200, h: 200, qty: 2, holeTools: [1] }],
    });
    expect(r.cost.toolChanges).toBe(0);
  });

  it('cut length = contour lengths + travel; reported in every mode, the total only weighs the mode terms', () => {
    const parts: NestPart[] = [{ id: 'a', w: 100, h: 50, qty: 2 }];
    const r = nest({ ...base, parts });
    // Two 100 × 50 rectangles: 600 mm of contour plus some travel from the origin.
    expect(r.cost.cutLength).toBeGreaterThan(600);
    expect(r.cost.handling).toBe(1);
    expect(r.cost.total).toBe(r.cost.wasteArea);
    const f = nest({ ...base, parts, mode: 'fastest' });
    expect(f.cost.total).toBeCloseTo(f.cost.wasteArea + 1000 * f.cost.cutLength, 6);
  });

  it('tries the tool-group ordering only when the copies need different tool sets', () => {
    const per = PLACER_HEURISTICS.length;
    expect(nest({ ...base, parts: [{ id: 'a', w: 10, h: 10, qty: 1 }] }).candidates).toBe(
      PART_ORDERINGS.length * per,
    );
    const mixed = nest({
      ...base,
      parts: [
        { id: 'a', w: 10, h: 10, qty: 1, holeTools: [2] },
        { id: 'b', w: 10, h: 10, qty: 1 },
      ],
    });
    expect(mixed.candidates).toBe((PART_ORDERINGS.length + 1) * per);
  });

  it('weights override the preset', () => {
    const r = nest({ ...kitchenHardware, mode: 'minWaste', weights: { toolChanges: 1e8 } });
    expect(r.cost.toolChanges).toBe(
      nest({ ...kitchenHardware, mode: 'minToolChanges' }).cost.toolChanges,
    );
  });
});

const partArb = (i: number): fc.Arbitrary<NestPart> =>
  fc.record({
    id: fc.constant(`p${i}`),
    w: fc.double({ min: 5, max: 900, noNaN: true }),
    h: fc.double({ min: 5, max: 700, noNaN: true }),
    qty: fc.integer({ min: 1, max: 4 }),
    grainLock: fc.boolean(),
    holeTools: fc.array(fc.integer({ min: 1, max: 4 }), { maxLength: 2 }),
  });

const inputArb: fc.Arbitrary<NestingInput> = fc.record({
  sheet: fc.record({
    width: fc.double({ min: 400, max: 2800, noNaN: true }),
    height: fc.double({ min: 400, max: 2100, noNaN: true }),
  }),
  parts: fc
    .integer({ min: 0, max: 8 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i)))),
  gap: fc.double({ min: 0, max: 15, noNaN: true }),
  margin: fc.double({ min: 0, max: 30, noNaN: true }),
  toolDiameter: fc.constantFrom(3, 6, 8, 12.7),
  mode: fc.constantFrom(...MODES),
  locked: fc.constant([]),
  contourTool: fc.constantFrom(1, 2, undefined),
});

describe('modes with tool sets (fast-check)', () => {
  it('keep the placer invariants and stay deterministic', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const a = nest(input);
        expect(invariantViolations(input, a)).toEqual([]);
        expect(JSON.stringify(nest(input))).toBe(JSON.stringify(a));
      }),
      { numRuns: 120 },
    );
  });

  it('no mode places fewer copies or opens more sheets than min-waste', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const w = nest({ ...input, mode: 'minWaste' });
        for (const mode of MODES) {
          const r = nest({ ...input, mode });
          expect(r.unplaced.length).toBe(w.unplaced.length);
          expect(r.sheetCount).toBe(w.sheetCount);
        }
      }),
      { numRuns: 60 },
    );
  });
});
