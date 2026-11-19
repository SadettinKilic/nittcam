import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { better, nest, type Candidate } from './nest';
import { invariantViolations } from './nest.testing';
import type { NestingInput, NestPart } from './types';

/** T164: several stock sheet sizes with quantity limits. */
const BIG = { width: 2800, height: 2070 };
const SMALL = { width: 1220, height: 1220 };

function input(parts: NestPart[], extra: Partial<NestingInput> = {}): NestingInput {
  return {
    sheet: BIG,
    parts,
    gap: 8,
    margin: 10,
    toolDiameter: 8,
    mode: 'minWaste',
    locked: [],
    ...extra,
  };
}

const part = (id: string, w: number, h: number, qty = 1): NestPart => ({
  id,
  w,
  h,
  qty,
  grainLock: false,
});

describe('multiple sheet sizes (T164)', () => {
  it('one listed size without a limit = the single-size result, no size on the sheets', () => {
    const parts = [part('a', 600, 400, 12), part('b', 300, 300, 7)];
    const plain = nest(input(parts));
    const listed = nest(input(parts, { sheets: [BIG] }));
    expect(listed).toEqual(plain);
    expect(plain.layout.sheets.every((s) => !('size' in s))).toBe(true);
  });

  it('a small leftover goes on the small size (less waste)', () => {
    const r = nest(input([part('a', 500, 500, 1)], { sheets: [BIG, SMALL] }));
    expect(r.layout.sheets).toHaveLength(1);
    expect(r.layout.sheets[0]?.size).toEqual(SMALL);
    expect(r.sheets[0]?.sheetArea).toBe(SMALL.width * SMALL.height);
    expect(
      invariantViolations(input([part('a', 500, 500, 1)], { sheets: [BIG, SMALL] }), r),
    ).toEqual([]);
  });

  it('a part that fits only the big size goes there', () => {
    const r = nest(input([part('long', 2000, 300, 1)], { sheets: [SMALL, BIG] }));
    expect(r.layout.sheets[0]?.size).toEqual(BIG);
    expect(r.unplaced).toEqual([]);
  });

  it('respects qty limits and reports NO_STOCK when the stock runs out', () => {
    const inp = input([part('a', 1000, 1000, 5)], { sheets: [{ ...SMALL, qty: 2 }] });
    const r = nest(inp);
    expect(r.layout.sheets).toHaveLength(2);
    expect(r.unplaced.map((u) => u.reason)).toEqual(['NO_STOCK', 'NO_STOCK', 'NO_STOCK']);
    expect(invariantViolations(inp, r)).toEqual([]);
  });

  it('still TOO_LARGE when no size takes the part', () => {
    const r = nest(input([part('huge', 3000, 3000, 1)], { sheets: [BIG, SMALL] }));
    expect(r.unplaced).toEqual([{ partId: 'huge', index: 0, reason: 'TOO_LARGE' }]);
  });

  it('property: invariants, qty limits and determinism across mixed sizes', () => {
    const arbPart = fc.record({
      w: fc.integer({ min: 50, max: 1500 }),
      h: fc.integer({ min: 50, max: 1100 }),
      qty: fc.integer({ min: 1, max: 6 }),
    });
    const arbSize = fc.record({
      width: fc.integer({ min: 800, max: 2800 }),
      height: fc.integer({ min: 800, max: 2100 }),
      qty: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(
        fc.array(arbPart, { minLength: 1, maxLength: 6 }),
        fc.array(arbSize, { minLength: 2, maxLength: 3 }),
        (ps, sizes) => {
          const sheets = sizes.map((s) =>
            s.qty === undefined ? { width: s.width, height: s.height } : s,
          );
          const inp = input(
            ps.map((p, i) => part(`p${i}`, p.w, p.h, p.qty)),
            { sheets },
          );
          const r = nest(inp);
          expect(invariantViolations(inp, r)).toEqual([]);
          sheets.forEach((d) => {
            if (!('qty' in d) || d.qty === undefined) return;
            const n = r.layout.sheets.filter(
              (s) => s.size?.width === d.width && s.size.height === d.height,
            ).length;
            const same = sheets.filter((o) => o.width === d.width && o.height === d.height);
            const cap = same.every((o) => 'qty' in o && o.qty !== undefined)
              ? same.reduce((sum, o) => sum + ('qty' in o && o.qty ? o.qty : 0), 0)
              : Infinity;
            expect(n).toBeLessThanOrEqual(cap);
          });
          expect(nest(inp)).toEqual(r);
        },
      ),
      { numRuns: 60, seed: 164 },
    );
  });
});

describe('candidate ranking with several sizes (T164, D-056)', () => {
  const area = (r: ReturnType<typeof nest>) => r.sheets.reduce((s, st) => s + st.sheetArea, 0);

  it('mixed sizes nest every copy on less area than the big size alone', () => {
    const parts = [part('a', 1100, 1100, 4)];
    const mixed = nest(input(parts, { sheets: [BIG, SMALL] }));
    const bigOnly = nest(input(parts));
    expect(mixed.unplaced).toEqual([]);
    expect(mixed.layout.sheets.length).toBeGreaterThan(bigOnly.layout.sheets.length);
    expect(area(mixed)).toBeLessThan(area(bigOnly));
    expect(invariantViolations(input(parts, { sheets: [BIG, SMALL] }), mixed)).toEqual([]);
  });

  it('better(): with several sizes the total area ranks before the sheet count, then the cost', () => {
    const cand = (dims: { width: number; height: number }[], total: number, unplaced = 0) =>
      ({
        layout: dims.map(() => []),
        dims,
        unplaced: Array.from({ length: unplaced }, () => ({})),
        cost: { total },
      }) as unknown as Candidate;
    const fourSmall = cand([SMALL, SMALL, SMALL, SMALL], 9);
    const twoBig = cand([BIG, BIG], 1);
    expect(better(fourSmall, twoBig, true)).toBe(true);
    expect(better(twoBig, fourSmall, false)).toBe(true); // one size: the count first, as before
    expect(better(cand([SMALL], 2), cand([SMALL], 3), true)).toBe(true); // same area: the cost
    expect(better(cand([BIG, BIG], 1), cand([SMALL], 1, 1), true)).toBe(true); // unplaced first
  });
});
