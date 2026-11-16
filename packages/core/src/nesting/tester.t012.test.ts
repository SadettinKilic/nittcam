/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index results of known length */
/**
 * T012 tester: independent checker for the placer. Deliberately does NOT import the engine's own
 * helpers (nest.testing, partSpacing, placementRect, fit): geometry is recomputed here from the
 * spec rules (D-019): spacing >= toolDiameter + gap, parts inside [margin, sheet - margin].
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Placement } from '../schema';
import { nest } from './nest';
import type { NestingInput, NestingResult, NestPart } from './types';

const TOL = 0.001 + 1e-9; // spec EPS (0.001 mm) plus float noise

interface R {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function footprint(input: NestingInput, p: Placement): R {
  const part = input.parts.find((q) => q.id === p.partId)!;
  const swap = p.rot === 90 || p.rot === 270;
  const w = swap ? part.h : part.w;
  const h = swap ? part.w : part.h;
  return { x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h };
}

/** Empty list = fine. Everything recomputed independently of the engine. */
function check(input: NestingInput, res: NestingResult): string[] {
  const bad: string[] = [];
  const need = input.toolDiameter + input.gap;
  const qty = new Map(input.parts.map((p) => [p.id, p.qty]));
  const grain = new Map(input.parts.map((p) => [p.id, p.grainLock]));
  const seen = new Map<string, number>();
  res.layout.sheets.forEach((sh, si) => {
    const rs = sh.placements.map((p) => footprint(input, p));
    sh.placements.forEach((p, i) => {
      const r = rs[i]!;
      for (const v of [p.x, p.y, r.x1, r.y1])
        if (!Number.isFinite(v)) bad.push(`NaN/inf ${p.partId}`);
      if (Object.is(p.x, -0) || Object.is(p.y, -0)) bad.push(`negative zero ${p.partId}`);
      if (!p.locked) {
        if (p.x < input.margin - TOL || p.y < input.margin - TOL)
          bad.push(`below margin ${p.partId}`);
        if (r.x1 > input.sheet.width - input.margin + TOL) bad.push(`right of margin ${p.partId}`);
        if (r.y1 > input.sheet.height - input.margin + TOL) bad.push(`above margin ${p.partId}`);
        if (grain.get(p.partId) && p.rot !== 0 && p.rot !== 180)
          bad.push(`grain ${p.partId} rot ${p.rot}`);
      }
      if (!(p.index >= 0 && p.index < (qty.get(p.partId) ?? 0)))
        bad.push(`bad index ${p.partId}#${p.index}`);
      const key = `${p.partId}#${p.index}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    });
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i]!;
        const b = rs[j]!;
        const dx = Math.max(b.x0 - a.x1, a.x0 - b.x1);
        const dy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
        if (Math.max(dx, dy) < need - TOL)
          bad.push(
            `sheet ${si}: ${sh.placements[i]!.partId} and ${sh.placements[j]!.partId} too close (${Math.max(dx, dy)} < ${need})`,
          );
      }
  });
  for (const u of res.unplaced) {
    const k = `${u.partId}#${u.index}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let total = 0;
  for (const p of input.parts) {
    total += p.qty;
    for (let i = 0; i < p.qty; i++)
      if (seen.get(`${p.id}#${i}`) !== 1)
        bad.push(`copy ${p.id}#${i} count ${seen.get(`${p.id}#${i}`)}`);
  }
  const placed = res.layout.sheets.reduce((n, s) => n + s.placements.length, 0);
  if (placed + res.unplaced.length !== total)
    bad.push(`placed ${placed} + unplaced ${res.unplaced.length} != ${total}`);
  input.locked.forEach((l, i) => {
    if (JSON.stringify(res.layout.sheets[i]?.placements.slice(0, l.length)) !== JSON.stringify(l))
      bad.push(`locked moved on sheet ${i}`);
  });
  return bad;
}

const sizeArb = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      w: fc.double({ min: 20, max: 900, noNaN: true }),
      h: fc.double({ min: 20, max: 900, noNaN: true }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      w: fc.constant(5),
      h: fc.double({ min: 1500, max: 2000, noNaN: true }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      w: fc.double({ min: 1500, max: 2000, noNaN: true }),
      h: fc.constant(5),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ w: 20, h: 20 }) },
  {
    weight: 1,
    arbitrary: fc.record({
      w: fc.double({ min: 20, max: 3500, noNaN: true }),
      h: fc.double({ min: 20, max: 2500, noNaN: true }),
    }),
  },
);

const partsArb = fc.integer({ min: 1, max: 200 }).chain((n) =>
  fc
    .array(fc.tuple(sizeArb, fc.integer({ min: 1, max: 3 }), fc.boolean()), {
      minLength: n,
      maxLength: n,
    })
    .map((arr) =>
      arr.map(([s, qty, grainLock], i): NestPart => ({
        id: `p${i}`,
        w: s.w,
        h: s.h,
        qty,
        grainLock,
      })),
    ),
);

const inputArb: fc.Arbitrary<NestingInput> = fc.record({
  sheet: fc.constantFrom(
    { width: 2800, height: 2070 },
    { width: 2440, height: 1220 },
    { width: 600, height: 400 },
  ),
  parts: partsArb,
  gap: fc.double({ min: 0, max: 30, noNaN: true }),
  margin: fc.double({ min: 0, max: 60, noNaN: true }),
  toolDiameter: fc.double({ min: 1, max: 25, noNaN: true }),
  mode: fc.constantFrom('minWaste' as const, 'fastest' as const, 'minToolChanges' as const),
  locked: fc.constant([]),
});

const lockedArb = fc
  .tuple(inputArb, fc.array(fc.boolean(), { minLength: 300, maxLength: 300 }))
  .map(([inp, picks]) => {
    // Lock a subset of a first run; turn some rot 0 into rot 180 (same footprint) for variety.
    let k = 0;
    const locked: Placement[][] = nest(inp).layout.sheets.map((sh) =>
      sh.placements
        .filter(() => picks[k++ % picks.length])
        .map(
          (p) =>
            ({ ...p, rot: p.rot === 0 && k % 3 === 0 ? 180 : p.rot, locked: true }) as Placement,
        ),
    );
    while (locked.length > 0 && locked[locked.length - 1]!.length === 0) locked.pop();
    return { ...inp, locked } as NestingInput;
  });

describe('T012 tester: independent invariants on random inputs', () => {
  it('no overlap/spacing, margin, grain, counts, finite coords (1-200 parts)', () => {
    fc.assert(
      fc.property(inputArb, (inp) => {
        expect(check(inp, nest(inp))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 240_000);

  it('same with locked placements; locked are byte-identical', () => {
    fc.assert(
      fc.property(lockedArb, (inp) => {
        expect(check(inp, nest(inp))).toEqual([]);
      }),
      { numRuns: 25 },
    );
  }, 240_000);

  it('deterministic: two runs deep-equal (byte-identical JSON)', () => {
    fc.assert(
      fc.property(lockedArb, (inp) => {
        const a = JSON.stringify(nest(inp));
        const b = JSON.stringify(nest(JSON.parse(JSON.stringify(inp)) as NestingInput));
        expect(a).toBe(b);
      }),
      { numRuns: 15 },
    );
  }, 240_000);
});

const base = (parts: NestPart[], over: Partial<NestingInput> = {}): NestingInput => ({
  sheet: { width: 1000, height: 500 },
  parts,
  gap: 6,
  margin: 10,
  toolDiameter: 8,
  mode: 'minWaste',
  locked: [],
  ...over,
});

describe('T012 tester: edge cases', () => {
  it('a part exactly the usable area fits with 0 spacing to the margins', () => {
    const inp = base([{ id: 'a', w: 980, h: 480, qty: 1, grainLock: true }]);
    const res = nest(inp);
    expect(res.unplaced).toEqual([]);
    expect(res.layout.sheets).toHaveLength(1);
    const p = res.layout.sheets[0]!.placements[0]!;
    expect(Math.abs(p.x - 10)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(p.y - 10)).toBeLessThanOrEqual(TOL);
    expect(check(inp, res)).toEqual([]);
  });

  it('a part 0.001 mm too large sits on the EPS boundary: D-019 accepts it, still within margin + EPS', () => {
    // Reported to dev: the task text expects TOO_LARGE at +0.001; D-019 accepts fits within EPS.
    for (const [w, h] of [
      [980.001, 480],
      [980, 480.001],
    ] as const) {
      const inp = base([{ id: 'a', w, h, qty: 1, grainLock: true }]);
      expect(check(inp, nest(inp)), `w=${w} h=${h}`).toEqual([]);
    }
  });

  it('a part 0.002 mm too large is TOO_LARGE', () => {
    const res = nest(base([{ id: 'a', w: 980.002, h: 480, qty: 1, grainLock: true }]));
    expect(res.unplaced).toHaveLength(1);
    expect(res.layout.sheets.flatMap((s) => s.placements)).toHaveLength(0);
  });

  it('rotated fit only when not grain-locked', () => {
    const free = nest(base([{ id: 'a', w: 480, h: 980, qty: 1, grainLock: false }]));
    expect(free.unplaced).toEqual([]);
    expect(free.layout.sheets[0]!.placements[0]!.rot).toBe(90);
    const locked = nest(base([{ id: 'a', w: 480, h: 980, qty: 1, grainLock: true }]));
    expect(locked.unplaced.map((u) => u.reason)).toEqual(['TOO_LARGE']);
  });

  it('empty parts list: 0 sheets, no crash, sane stats', () => {
    const res = nest(base([]));
    expect(res.sheetCount).toBe(0);
    expect(res.layout.sheets).toEqual([]);
    expect(res.unplaced).toEqual([]);
    expect(Number.isFinite(res.wastePercent)).toBe(true);
    expect(Number.isNaN(res.utilisationPercent)).toBe(false);
  });

  it('qty 500 of one part: all placed once, invariants hold, fast', () => {
    const inp = base([{ id: 'a', w: 120, h: 90, qty: 500, grainLock: false }], {
      sheet: { width: 2800, height: 2070 },
    });
    const t = Date.now();
    const res = nest(inp);
    expect(Date.now() - t).toBeLessThan(10_000);
    expect(check(inp, res)).toEqual([]);
    expect(res.unplaced).toEqual([]);
    expect(res.layout.sheets.reduce((n, s) => n + s.placements.length, 0)).toBe(500);
  });

  it('qty 500 of a very thin part (5 x 2000)', () => {
    const inp = base([{ id: 't', w: 5, h: 2000, qty: 500, grainLock: true }], {
      sheet: { width: 2800, height: 2070 },
    });
    expect(check(inp, nest(inp))).toEqual([]);
  });

  it('locked placement in the margin / overlapping another locked part: no crash, locked kept, free copy avoids them (behaviour reported)', () => {
    const lp = (x: number, y: number, index: number): Placement => ({
      partId: 'a',
      index,
      x,
      y,
      rot: 0,
      locked: true,
    });
    const inp = base([{ id: 'a', w: 100, h: 100, qty: 4, grainLock: false }], {
      locked: [[lp(0, 0, 0), lp(300, 300, 1), lp(300, 300, 2)]],
    });
    const res = nest(inp);
    expect(res.layout.sheets[0]!.placements.slice(0, 3)).toEqual(inp.locked[0]);
    const free = res.layout.sheets.flatMap((s, si) =>
      s.placements.filter((p) => !p.locked).map((p) => ({ si, p })),
    );
    expect(free).toHaveLength(1);
    const f = footprint(inp, free[0]!.p);
    if (free[0]!.si === 0)
      for (const l of inp.locked[0]!) {
        const r = footprint(inp, l);
        expect(Math.max(r.x0 - f.x1, f.x0 - r.x1, r.y0 - f.y1, f.y0 - r.y1)).toBeGreaterThanOrEqual(
          14 - TOL,
        );
      }
  });
});
