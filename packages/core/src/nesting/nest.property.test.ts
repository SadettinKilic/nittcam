/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index results whose length is known */
/**
 * Property tests of the placer invariants (spec §6.2, nesting-engine skill): no overlap after
 * inflation, inside the usable area, gap ≥ tool + gap, grain rule, deterministic, locked placements
 * unchanged, every copy placed or unplaced with a reason exactly once.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Placement } from '../schema';
import { nest } from './nest';
import { invariantViolations } from './nest.testing';
import type { NestingInput, NestPart } from './types';

const partArb = (i: number): fc.Arbitrary<NestPart> =>
  fc.record({
    id: fc.constant(`p${i}`),
    // Mostly parts that fit, sometimes one larger than the sheet.
    w: fc.oneof(
      { weight: 9, arbitrary: fc.double({ min: 5, max: 1400, noNaN: true }) },
      { weight: 1, arbitrary: fc.double({ min: 1400, max: 4000, noNaN: true }) },
    ),
    h: fc.double({ min: 5, max: 1200, noNaN: true }),
    qty: fc.integer({ min: 1, max: 6 }),
    grainLock: fc.boolean(),
  });

const partsArb = fc
  .integer({ min: 0, max: 12 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i))));

const inputArb: fc.Arbitrary<NestingInput> = fc.record({
  sheet: fc.record({
    width: fc.double({ min: 300, max: 3000, noNaN: true }),
    height: fc.double({ min: 300, max: 2200, noNaN: true }),
  }),
  parts: partsArb,
  gap: fc.double({ min: 0, max: 20, noNaN: true }),
  margin: fc.double({ min: 0, max: 40, noNaN: true }),
  toolDiameter: fc.constantFrom(3, 6, 8, 10, 12.7),
  mode: fc.constantFrom('minWaste' as const, 'fastest' as const, 'minToolChanges' as const),
  locked: fc.constant([]),
});

/**
 * Locks a random subset of a first run's placements and nests again: the locked ones must stay,
 * the rest must respect them.
 */
const withLockedArb: fc.Arbitrary<NestingInput> = fc
  .tuple(inputArb, fc.array(fc.boolean(), { maxLength: 80 }))
  .map(([inp, picks]) => {
    const first = nest(inp);
    let k = 0;
    const locked: Placement[][] = first.layout.sheets.map((sh) =>
      sh.placements.filter(() => picks[k++] ?? false).map((p) => ({ ...p, locked: true })),
    );
    while (locked.length > 0 && locked[locked.length - 1]!.length === 0) locked.pop();
    return { ...inp, locked };
  });

describe('nest invariants (fast-check)', () => {
  it('no overlap, inside usable area, gap kept, grain rule, every copy accounted for', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        expect(invariantViolations(inp, nest(inp))).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('locked placements are never moved and other parts avoid them', () => {
    fc.assert(
      fc.property(withLockedArb, (inp) => {
        const r = nest(inp);
        expect(invariantViolations(inp, r)).toEqual([]);
        inp.locked.forEach((locked, i) => {
          expect(r.layout.sheets[i]!.placements.slice(0, locked.length)).toEqual(locked);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('deterministic: same input → byte-identical output', () => {
    fc.assert(
      fc.property(withLockedArb, (inp) => {
        const a = nest(inp);
        const b = nest(JSON.parse(JSON.stringify(inp)) as NestingInput);
        expect(b).toEqual(a);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 150 },
    );
  });

  it('grain-locked parts are never turned 90°', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        const locked = { ...inp, parts: inp.parts.map((p) => ({ ...p, grainLock: true })) };
        for (const sh of nest(locked).layout.sheets) {
          for (const p of sh.placements) expect([0, 180]).toContain(p.rot);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('the order of the input part list does not change the result', () => {
    // Reversing the part list must give the same result: orderings sort by key, then id.
    fc.assert(
      fc.property(inputArb, (inp) => {
        const a = nest(inp);
        const b = nest({ ...inp, parts: [...inp.parts].reverse() });
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 100 },
    );
  });
});
