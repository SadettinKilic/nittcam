import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultMachineProfile } from './defaults';
import { MATERIAL_KIND_IDS } from './material-kinds';
import { materialParamsSchema, type Tool } from './profile';
import {
  STARTING_VALUE_ROWS,
  diameterBand,
  startingValueRow,
  startingValueSourceNames,
  depthChipLoadFactor,
  suggestCuttingSet,
  toolFitHint,
} from './starting-values';

// T327: built-in starting values per material (research doc §c, §d; D-120).

const SPINDLE = { minRpm: 6000, maxRpm: 24000 };
const tool = (
  diameter: number,
  flutes = 2,
  type: Tool['type'] = 'flatEndMill',
  fluteLength = 25,
): Tool => ({ number: 1, type, diameter, flutes, fluteLength });

const pick = (s: ReturnType<typeof suggestCuttingSet>) =>
  s && { feed: s.feed, plungeFeed: s.plungeFeed, rpm: s.rpm, stepDown: s.stepDown };

describe('suggestCuttingSet', () => {
  it("MDF 18 with the Ø8 two-flute end mill equals today's built-in set exactly", () => {
    const p = defaultMachineProfile();
    const set = p.materials[0];
    const t = p.tools.find((x) => x.number === set?.tool);
    if (!set || !t) throw new Error('default profile without its MDF set');
    expect(set).toMatchObject({ material: 'mdf', thickness: 18 });
    const s = suggestCuttingSet('mdf', 18, t, p.spindle);
    expect(pick(s)).toEqual({
      feed: set.feed,
      plungeFeed: set.plungeFeed,
      rpm: set.rpm,
      stepDown: set.stepDown,
    });
    expect(pick(s)).toEqual({ feed: 6000, plungeFeed: 1500, rpm: 18000, stepDown: 6 });
  });

  // Spot checks against research §d (feed, plunge, step-down for 18 mm / 10 mm stock).
  it.each([
    ['mdf', 18, tool(6), { feed: 5400, plungeFeed: 1300, rpm: 18000, stepDown: 6 }],
    ['plywood', 18, tool(6), { feed: 4700, plungeFeed: 1100, rpm: 18000, stepDown: 6 }],
    ['plywood', 18, tool(8), { feed: 5000, plungeFeed: 1200, rpm: 18000, stepDown: 6 }],
    [
      'melamine',
      18,
      tool(6, 2, 'compression'),
      // PO B61: Ø6 compression steps down 1 × D (6), not 1,5 × D.
      { feed: 4700, plungeFeed: 1100, rpm: 18000, stepDown: 6 },
    ],
    [
      'melamine',
      18,
      tool(8, 2, 'compression'),
      { feed: 5400, plungeFeed: 1300, rpm: 18000, stepDown: 9 },
    ],
    ['melamine', 18, tool(8), { feed: 5000, plungeFeed: 1200, rpm: 18000, stepDown: 6 }],
    ['solidWood', 18, tool(6), { feed: 3600, plungeFeed: 900, rpm: 18000, stepDown: 3 }],
    ['solidWood', 18, tool(8), { feed: 4300, plungeFeed: 1000, rpm: 18000, stepDown: 4 }],
    // PO B61: plastics plunge at 0,25 × feed (straight entry by default), down to the 100.
    ['acrylic', 10, tool(6, 1), { feed: 3000, plungeFeed: 700, rpm: 18000, stepDown: 3 }],
    ['acrylic', 10, tool(8, 1), { feed: 3600, plungeFeed: 900, rpm: 18000, stepDown: 4 }],
    ['acrylic', 10, tool(8, 2), { feed: 5000, plungeFeed: 1200, rpm: 18000, stepDown: 4 }],
    ['pvc', 10, tool(8, 1), { feed: 3200, plungeFeed: 800, rpm: 18000, stepDown: 4 }],
    ['pvc', 10, tool(8, 2), { feed: 5000, plungeFeed: 1200, rpm: 18000, stepDown: 4 }],
    // PO B61: plunge = share × feed, down to the 100 (safe side); these three equal §d.
    ['acrylic', 10, tool(6, 2), { feed: 4300, plungeFeed: 1000, rpm: 18000, stepDown: 3 }],
    ['pvc', 10, tool(6, 1), { feed: 2700, plungeFeed: 600, rpm: 18000, stepDown: 3 }],
    ['pvc', 10, tool(6, 2), { feed: 4300, plungeFeed: 1000, rpm: 18000, stepDown: 3 }],
  ] as const)('%s %d mm with %o', (kind, thickness, t, expected) => {
    expect(pick(suggestCuttingSet(kind, thickness, t, SPINDLE))).toEqual(expected);
  });

  it('clamps the rpm to the spindle range and recomputes the feed', () => {
    // MDF Ø8: 0,167 × 2 × 12 000 = 4008 → 4000.
    expect(
      pick(suggestCuttingSet('mdf', 18, tool(8), { minRpm: 6000, maxRpm: 12000 })),
    ).toMatchObject({ rpm: 12000, feed: 4000, plungeFeed: 1000 });
    // Acrylic Ø6 O-flute: 0,167 × 1 × 6000 = 1002 → 1000.
    expect(
      pick(suggestCuttingSet('acrylic', 10, tool(6, 1), { minRpm: 6000, maxRpm: 6000 })),
    ).toMatchObject({ rpm: 6000, feed: 1000 });
    // A spindle that cannot go below 24 000.
    expect(
      pick(suggestCuttingSet('mdf', 18, tool(8), { minRpm: 24000, maxRpm: 24000 })),
    ).toMatchObject({ rpm: 24000, feed: 8000 });
  });

  it('step-down never exceeds the flute length or the sheet', () => {
    expect(suggestCuttingSet('mdf', 18, tool(8, 2, 'flatEndMill', 4), SPINDLE)?.stepDown).toBe(4);
    expect(suggestCuttingSet('mdf', 3, tool(8), SPINDLE)?.stepDown).toBe(3);
    expect(suggestCuttingSet('acrylic', 2, tool(6, 1), SPINDLE)?.stepDown).toBe(2);
  });

  it('no row → no suggestion, never a guess', () => {
    expect(suggestCuttingSet('mdf', 18, tool(5), SPINDLE)).toBeUndefined();
    expect(suggestCuttingSet('mdf', 18, tool(8, 3), SPINDLE)).toBeUndefined();
    expect(suggestCuttingSet('mdf', 18, tool(8, 2, 'ballEndMill'), SPINDLE)).toBeUndefined();
    expect(suggestCuttingSet('mdf', 18, tool(8, 2, 'vBit'), SPINDLE)).toBeUndefined();
    expect(suggestCuttingSet('melamine', 18, tool(6), SPINDLE)).toBeUndefined();
    expect(suggestCuttingSet('pvc', 10, tool(4, 1), SPINDLE)).toBeUndefined();
    expect(suggestCuttingSet('mdf', 18, tool(20), SPINDLE)).toBeUndefined();
  });

  it('inch tools fall in the band of their metric neighbour', () => {
    expect(diameterBand(3.175)).toBe(3);
    expect(diameterBand(6.35)).toBe(6);
    expect(diameterBand(7.94)).toBe(8);
    expect(diameterBand(12.7)).toBe(12);
    expect(diameterBand(5)).toBeUndefined();
    expect(startingValueRow('mdf', tool(6.35))?.id).toBe('mdf-flatEndMill-2-6');
  });

  it('property: every suggestion is inside its chip-load band and the machine limits', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STARTING_VALUE_ROWS),
        fc.integer({ min: 1000, max: 60000 }),
        fc.integer({ min: 1000, max: 60000 }),
        fc.double({ min: 0.5, max: 200, noNaN: true }),
        fc.double({ min: 1, max: 200, noNaN: true }),
        (row, a, b, thickness, fluteLength) => {
          const spindle = { minRpm: Math.min(a, b), maxRpm: Math.max(a, b) };
          const t = tool(row.diameter, row.flutes, row.toolType, fluteLength);
          const s = suggestCuttingSet(row.kind, thickness, t, spindle);
          expect(s?.row).toBe(row);
          if (!s) return;
          expect(s.rpm).toBeGreaterThanOrEqual(spindle.minRpm);
          expect(s.rpm).toBeLessThanOrEqual(spindle.maxRpm);
          // Feed rounding to 100 mm/min moves the chip load by at most 50 / (z × rpm).
          const slack = 50 / (row.flutes * s.rpm) + 1e-9;
          const lo = Math.min(row.chipLoad.min, row.chipLoad.typ);
          if (s.feed > 100) expect(s.chipLoad).toBeGreaterThanOrEqual(lo - slack);
          expect(s.chipLoad).toBeLessThanOrEqual(row.chipLoad.max + slack);
          expect(s.stepDown).toBeLessThanOrEqual(fluteLength);
          expect(s.stepDown).toBeLessThanOrEqual(thickness);
          expect(s.plungeFeed).toBeLessThanOrEqual(s.feed);
          const set = { material: row.kind, thickness, tool: 1, ...pick(s) };
          expect(materialParamsSchema.safeParse(set).success).toBe(true);
        },
      ),
    );
  });
});

describe('STARTING_VALUE_ROWS', () => {
  it('every row has sources, a sane band and rpm, and a unique id', () => {
    const ids = new Set<string>();
    for (const r of STARTING_VALUE_ROWS) {
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.chipLoad.max).toBeGreaterThan(r.chipLoad.min);
      expect(r.chipLoad.max).toBeGreaterThan(r.chipLoad.typ);
      expect(r.rpm.typ).toBeGreaterThanOrEqual(6000);
      expect(r.rpm.typ).toBeLessThanOrEqual(24000);
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
      expect(startingValueSourceNames(r).length).toBeGreaterThan(0);
    }
  });

  it('covers every kind (T346: ACM and aluminium too)', () => {
    const kinds = new Set(STARTING_VALUE_ROWS.map((r) => r.kind));
    expect([...kinds].sort()).toEqual([...MATERIAL_KIND_IDS].sort());
  });
});

describe('toolFitHint', () => {
  it('hints, never blocks: compression for melamine, single flute for plastics', () => {
    expect(toolFitHint('melamine', tool(8))).toBe('melamineCompression');
    expect(toolFitHint('melamine', tool(8, 2, 'compression'))).toBeNull();
    expect(toolFitHint('acrylic', tool(6))).toBe('plasticSingleFlute');
    expect(toolFitHint('pvc', tool(6))).toBe('plasticSingleFlute');
    expect(toolFitHint('acrylic', tool(6, 1))).toBeNull();
    expect(toolFitHint('mdf', tool(8))).toBeNull();
    // The two-flute acrylic row still suggests values (a hint, not a block).
    expect(suggestCuttingSet('acrylic', 10, tool(6), SPINDLE)).toBeDefined();
  });
});

describe('depthChipLoadFactor (research §c depth correction)', () => {
  it('1 up to 1 × D, 0,75 at 2 × D, 0,5 from 3 × D, linear between', () => {
    expect(depthChipLoadFactor(0.5)).toBe(1);
    expect(depthChipLoadFactor(1)).toBe(1);
    expect(depthChipLoadFactor(1.5)).toBeCloseTo(0.875, 12);
    expect(depthChipLoadFactor(2)).toBe(0.75);
    expect(depthChipLoadFactor(3)).toBe(0.5);
    expect(depthChipLoadFactor(5)).toBe(0.5);
  });

  it('rows deeper than 1 × D already carry it: typ ≤ corrected source minimum (+ rounding)', () => {
    const deep = STARTING_VALUE_ROWS.filter((r) => r.stepDownFactor > 1);
    // PO B61: the Ø6 compression row steps down 1 × D now; only Ø8 goes deeper.
    expect(deep.map((r) => r.id).sort()).toEqual(['melamine-compression-2-8']);
    for (const r of deep) {
      expect(r.chipLoad.typ).toBeLessThanOrEqual(
        r.chipLoad.min * depthChipLoadFactor(r.stepDownFactor) + 0.005,
      );
    }
  });
});
