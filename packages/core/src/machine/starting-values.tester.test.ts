import { describe, expect, it } from 'vitest';
import { defaultMachineProfile, exampleMachineProfile } from './defaults';
import type { Tool } from './profile';
import { STARTING_VALUE_ROWS, startingValueRow, suggestCuttingSet } from './starting-values';

// B61 tester (T327, T329): every coded Ø6 / Ø8 row against the research doc §d
// (`docs/materials/kesim-degerleri-arastirma.md`), with the PO rule "plunge down to the 100".

const SPINDLE = { minRpm: 6000, maxRpm: 24000 };
const tool = (
  diameter: number,
  flutes = 2,
  type: Tool['type'] = 'flatEndMill',
  fluteLength = 30,
): Tool => ({ number: 1, type, diameter, flutes, fluteLength });

const pick = (s: ReturnType<typeof suggestCuttingSet>) =>
  s && { feed: s.feed, plungeFeed: s.plungeFeed, rpm: s.rpm, stepDown: s.stepDown };

type Case = [
  kind: Parameters<typeof suggestCuttingSet>[0],
  d: number,
  z: number,
  type: Tool['type'],
  feed: number,
  plungeDoc: number,
  stepDown: number,
];

// §d "Uygulamadaki malzemeler" (solidWood = hardwood, pvc = rigid PVC; PO decision).
// PO decisions B61 (after the tester review): plastics plunge 0,25 × feed (down to the 100)
// instead of §d's 0,5 × feed; melamine compression Ø6 steps down 6 (1 × D) instead of 9.
const DOC_D: Case[] = [
  ['mdf', 6, 2, 'flatEndMill', 5400, 1400, 6],
  ['mdf', 8, 2, 'flatEndMill', 6000, 1500, 6],
  ['plywood', 6, 2, 'flatEndMill', 4700, 1200, 6],
  ['plywood', 8, 2, 'flatEndMill', 5000, 1300, 6],
  ['melamine', 6, 2, 'compression', 4700, 1200, 6],
  ['melamine', 8, 2, 'compression', 5400, 1400, 9],
  ['melamine', 8, 2, 'flatEndMill', 5000, 1300, 6],
  ['solidWood', 6, 2, 'flatEndMill', 3600, 900, 3],
  ['solidWood', 8, 2, 'flatEndMill', 4300, 1100, 4],
  ['acrylic', 6, 1, 'flatEndMill', 3000, 700, 3],
  ['acrylic', 8, 1, 'flatEndMill', 3600, 900, 4],
  ['acrylic', 6, 2, 'flatEndMill', 4300, 1000, 3],
  ['acrylic', 8, 2, 'flatEndMill', 5000, 1200, 4],
  ['pvc', 6, 1, 'flatEndMill', 2700, 600, 3],
  ['pvc', 8, 1, 'flatEndMill', 3200, 800, 4],
  ['pvc', 6, 2, 'flatEndMill', 4300, 1000, 3],
  ['pvc', 8, 2, 'flatEndMill', 5000, 1200, 4],
];

describe('B61 tester: §d Ø6 / Ø8 rows', () => {
  it.each(DOC_D)('%s Ø%s z%s %s', (kind, d, z, type, feed, plungeDoc, stepDown) => {
    const s = suggestCuttingSet(kind, 18, tool(d, z, type), SPINDLE);
    if (!s) throw new Error('no suggestion');
    expect(s.rpm).toBe(18000);
    // feed = chip load × z × rpm, nearest 100 (§d value).
    expect(s.feed).toBe(feed);
    expect(Math.abs(s.feed - s.row.chipLoad.typ * z * 18000)).toBeLessThanOrEqual(50);
    // plunge = share × feed, DOWN to the 100: never above §d, at most 100 below it.
    expect(s.plungeFeed).toBe(Math.floor((s.row.plungeShare * s.feed + 1e-6) / 100) * 100);
    expect(s.plungeFeed).toBeLessThanOrEqual(plungeDoc);
    expect(plungeDoc - s.plungeFeed).toBeLessThanOrEqual(100);
    expect(s.stepDown).toBe(stepDown);
    // chip load start: the §c start (may lie under cl_min on purpose), never above cl_max.
    expect(s.chipLoad).toBeLessThanOrEqual(s.row.chipLoad.max);
  });

  it('wood plunge stays at or below a quarter of the feed, plastics at or below half', () => {
    for (const r of STARTING_VALUE_ROWS) {
      const s = suggestCuttingSet(r.kind, 18, tool(r.diameter, r.flutes, r.toolType), SPINDLE);
      if (!s) throw new Error(r.id);
      const limit = r.kind === 'acrylic' || r.kind === 'pvc' ? 0.5 : 0.25;
      expect(s.plungeFeed, r.id).toBeLessThanOrEqual(limit * s.feed);
      // step-down ≤ 1 × D, except the melamine compression rows (first pass ≥ down-cut length).
      if (r.toolType !== 'compression') expect(s.stepDown, r.id).toBeLessThanOrEqual(r.diameter);
    }
  });

  it('spot checks outside Ø6 / Ø8 (§c)', () => {
    // MDF Ø12: 0,24 × 2 × 18000 = 8640 → 8600; plunge 2150 → 2100; 0,5 × 12 = 6.
    expect(pick(suggestCuttingSet('mdf', 18, tool(12), SPINDLE))).toEqual({
      feed: 8600,
      plungeFeed: 2100,
      rpm: 18000,
      stepDown: 6,
    });
    // Plywood Ø3: 0,08 × 2 × 18000 = 2880 → 2900; plunge 725 → 700; 1 × 3.
    expect(pick(suggestCuttingSet('plywood', 18, tool(3), SPINDLE))).toEqual({
      feed: 2900,
      plungeFeed: 700,
      rpm: 18000,
      stepDown: 3,
    });
    // Acrylic Ø12 O-flute: rpm 16000, 0,25 × 16000 = 4000; plunge 1000 (PO B61: 0,25 × feed);
    // 0,5 × 12 = 6.
    expect(pick(suggestCuttingSet('acrylic', 18, tool(12, 1), SPINDLE))).toEqual({
      feed: 4000,
      plungeFeed: 1000,
      rpm: 16000,
      stepDown: 6,
    });
    // Melamine compression Ø10: 0,20 × 36000 = 7200; plunge 1800; 0,9 × 10 = 9.
    expect(pick(suggestCuttingSet('melamine', 18, tool(10, 2, 'compression'), SPINDLE))).toEqual({
      feed: 7200,
      plungeFeed: 1800,
      rpm: 18000,
      stepDown: 9,
    });
  });

  it('step-down never above the flute length or the sheet', () => {
    const s = suggestCuttingSet('melamine', 18, tool(8, 2, 'compression', 7), SPINDLE);
    expect(s?.stepDown).toBe(7);
    expect(suggestCuttingSet('acrylic', 3, tool(8, 1), SPINDLE)?.stepDown).toBe(3);
  });

  it('a 6 000–12 000 rpm spindle clamps rpm and recomputes the feed', () => {
    const lim = { minRpm: 6000, maxRpm: 12000 };
    // MDF Ø8: 0,167 × 2 × 12000 = 4008 → 4000; plunge 1000.
    expect(pick(suggestCuttingSet('mdf', 18, tool(8), lim))).toEqual({
      feed: 4000,
      plungeFeed: 1000,
      rpm: 12000,
      stepDown: 6,
    });
    // Plywood Ø6: 0,13 × 2 × 12000 = 3120 → 3100; plunge 775 → 700.
    expect(pick(suggestCuttingSet('plywood', 18, tool(6), lim))).toEqual({
      feed: 3100,
      plungeFeed: 700,
      rpm: 12000,
      stepDown: 6,
    });
    for (const r of STARTING_VALUE_ROWS) {
      const s = suggestCuttingSet(r.kind, 18, tool(r.diameter, r.flutes, r.toolType), lim);
      expect(s?.rpm, r.id).toBe(12000);
      expect(
        Math.abs((s?.feed ?? 0) - r.chipLoad.typ * r.flutes * 12000),
        r.id,
      ).toBeLessThanOrEqual(50);
    }
  });

  it('missing rows give no suggestion', () => {
    const none: [Parameters<typeof suggestCuttingSet>[0], Tool][] = [
      ['melamine', tool(6, 2, 'flatEndMill')],
      ['melamine', tool(10, 2, 'flatEndMill')],
      ['mdf', tool(6, 1)],
      ['mdf', tool(8, 3)],
      ['plywood', tool(6, 4)],
      ['mdf', tool(8, 2, 'vBit')],
      ['mdf', tool(8, 2, 'ballEndMill')],
      ['plywood', tool(6, 2, 'compression')],
      ['acrylic', tool(3, 2)],
      ['pvc', tool(4, 1)],
      ['mdf', tool(5, 2)],
      ['mdf', tool(20, 2)],
    ];
    for (const [kind, t] of none) {
      expect(startingValueRow(kind, t), `${kind} ${t.type} z${t.flutes} Ø${t.diameter}`).toBe(
        undefined,
      );
      expect(suggestCuttingSet(kind, 18, t, SPINDLE)).toBeUndefined();
    }
  });

  it('T329: example machine Melamin 18 / Kontrplak 18 from the table, MDF 18 unchanged', () => {
    const ex = exampleMachineProfile();
    const [mdf] = defaultMachineProfile().materials;
    expect(ex.materials[0]).toEqual(mdf);
    for (const m of ['melamine', 'plywood'] as const) {
      const set = ex.materials.find((x) => x.material === m && x.thickness === 18);
      expect(set).toMatchObject({ feed: 5000, plungeFeed: 1200, rpm: 18000, stepDown: 6, tool: 2 });
      expect(set?.copiedFrom).toBeUndefined();
    }
    expect(ex.example).toBe(true);
  });
});
