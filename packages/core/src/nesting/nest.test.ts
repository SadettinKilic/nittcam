/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion -- tests edit raw JSON and index known results */
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import mixed from '../schema/__fixtures__/mixed.json';
import { parseProject, type Project } from '../schema';
import { GuillotineBin, MaxRectsBin } from './bins';
import {
  nest,
  nestProject,
  nestingInputFromProject,
  partSpacing,
  PART_ORDERINGS,
  PLACER_HEURISTICS,
  summarizeLayout,
} from './nest';
import { invariantViolations } from './nest.testing';
import type { NestingInput, NestPart } from './types';

function load(json: unknown, mutate: (j: any) => void = () => {}): Project {
  const copy = JSON.parse(JSON.stringify(json));
  mutate(copy);
  const r = parseProject(copy);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const SHEET = { width: 2800, height: 2070 };

function input(parts: NestPart[], extra: Partial<NestingInput> = {}): NestingInput {
  return {
    sheet: SHEET,
    parts,
    gap: 8,
    margin: 10,
    toolDiameter: 8,
    mode: 'minWaste',
    locked: [],
    ...extra,
  };
}

const part = (id: string, w: number, h: number, qty = 1, grainLock = false): NestPart => ({
  id,
  w,
  h,
  qty,
  grainLock,
});

describe('spacing (D-019)', () => {
  it('inflation per side is (tool diameter + gap) / 2', () => {
    expect(partSpacing(8, 8)).toBe(8);
    expect(partSpacing(6, 0)).toBe(3);
  });

  it('two parts in a row are exactly tool + gap apart; the first sits on the margin', () => {
    const r = nest(input([part('a', 500, 500, 2)], { sheet: { width: 1040, height: 600 } }));
    // usable 1020 wide: 500 + 16 + 500 = 1016 fits.
    expect(r.sheetCount).toBe(1);
    const xs = r.layout.sheets[0]!.placements.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(10);
    expect(xs[1]).toBe(10 + 500 + 16);
  });

  it('one mm short of tool + gap opens a second sheet', () => {
    const r = nest(input([part('a', 500, 500, 2)], { sheet: { width: 1035, height: 540 } }));
    // usable 1015 × 520: 1016 needed side by side, and 1016 stacked: two sheets.
    expect(r.sheetCount).toBe(2);
    expect(
      invariantViolations(
        input([part('a', 500, 500, 2)], { sheet: { width: 1035, height: 540 } }),
        r,
      ),
    ).toEqual([]);
  });
});

describe('nest: fixtures and edge cases', () => {
  it('the shelf-set fixture fits on one sheet, nothing unplaced', () => {
    const project = load(shelfSet);
    const r = nestProject(project, { toolDiameter: 8 });
    expect(r.sheetCount).toBe(1);
    expect(r.unplaced).toEqual([]);
    expect(r.layout.sheets[0]!.placements).toHaveLength(8);
    expect(invariantViolations(nestingInputFromProject(project, { toolDiameter: 8 }), r)).toEqual(
      [],
    );
    expect(r.candidates).toBe(PART_ORDERINGS.length * PLACER_HEURISTICS.length);
    // 2 × 300×1800 + 5 × 764×280 + 800×300 on a 2800 × 2070 sheet.
    const partArea = 2 * 300 * 1800 + 5 * 764 * 280 + 800 * 300;
    expect(r.partArea).toBe(partArea);
    expect(r.wastePercent).toBeCloseTo((100 * (2800 * 2070 - partArea)) / (2800 * 2070), 9);
    expect(r.utilisationPercent).toBeCloseTo(100 - r.wastePercent, 9);
  });

  it('a part larger than the sheet → unplaced TOO_LARGE, the rest is nested', () => {
    const r = nest(input([part('big', 3000, 500, 2), part('ok', 400, 400)]));
    expect(r.unplaced).toEqual([
      { partId: 'big', index: 0, reason: 'TOO_LARGE' },
      { partId: 'big', index: 1, reason: 'TOO_LARGE' },
    ]);
    expect(r.sheetCount).toBe(1);
  });

  it('larger than the sheet minus the margin → TOO_LARGE (margin counts)', () => {
    const r = nest(input([part('edge', 2790, 100, 1, true)]));
    expect(r.unplaced.map((u) => u.reason)).toEqual(['TOO_LARGE']);
    expect(r.sheetCount).toBe(0);
    expect(r.layout.sheets).toEqual([]);
    expect(r.wastePercent).toBe(0);
  });

  it('a grain-locked part that only fits turned → TOO_LARGE; free → placed at 90°', () => {
    const locked = nest(
      input([part('tall', 2500, 400, 1, true)], { sheet: { width: 1000, height: 2800 } }),
    );
    expect(locked.unplaced).toHaveLength(1);
    const free = nest(
      input([part('tall', 2500, 400, 1, false)], { sheet: { width: 1000, height: 2800 } }),
    );
    expect(free.unplaced).toEqual([]);
    expect(free.layout.sheets[0]!.placements[0]!.rot).toBe(90);
  });

  it('exact fit of the usable area is accepted', () => {
    const r = nest(input([part('full', 2780, 2050, 1, true)]));
    expect(r.unplaced).toEqual([]);
    expect(r.layout.sheets[0]!.placements[0]).toMatchObject({ x: 10, y: 10, rot: 0 });
    expect(r.wastePercent).toBeCloseTo((100 * (2800 * 2070 - 2780 * 2050)) / (2800 * 2070), 9);
  });

  it('multi-sheet overflow: 10 half sheets need 10 sheets, every copy placed once', () => {
    const inp = input([part('half', 1500, 1100, 10, true)]);
    const r = nest(inp);
    expect(r.sheetCount).toBe(10);
    expect(r.sheets.map((s) => s.placed)).toEqual(Array(10).fill(1));
    expect(invariantViolations(inp, r)).toEqual([]);
  });

  it('multi-sheet: 9 quarter-ish parts fit 4 per sheet → 3 sheets', () => {
    const inp = input([part('q', 1380, 1015, 9, true)]);
    const r = nest(inp);
    // usable 2780 × 2050: 1380 + 16 + 1380 = 2776 ≤ 2780, 1015 + 16 + 1015 = 2046 ≤ 2050.
    expect(r.sheetCount).toBe(3);
    expect(r.sheets.map((s) => s.placed)).toEqual([4, 4, 1]);
    expect(invariantViolations(inp, r)).toEqual([]);
  });

  it('no parts → no sheets', () => {
    const r = nest(input([]));
    expect(r.sheetCount).toBe(0);
    expect(r.unplaced).toEqual([]);
    expect(r.utilisationPercent).toBe(0);
  });

  it('margin larger than half the sheet → everything TOO_LARGE, no loop', () => {
    const r = nest(input([part('a', 10, 10, 3)], { margin: 2000 }));
    expect(r.unplaced).toHaveLength(3);
    expect(r.sheetCount).toBe(0);
  });

  it('locked placements are kept and act as obstacles; other copies avoid them', () => {
    const lockedPl = { partId: 'a', index: 0, x: 600, y: 600, rot: 0 as const, locked: true };
    const inp = input([part('a', 500, 500, 6)], { locked: [[lockedPl]] });
    const r = nest(inp);
    expect(r.layout.sheets[0]!.placements[0]).toEqual(lockedPl);
    expect(invariantViolations(inp, r)).toEqual([]);
    expect(r.sheetCount).toBe(1);
  });

  it('a locked placement on sheet 2 keeps sheet 1 (filled with free parts)', () => {
    const lockedPl = { partId: 'a', index: 3, x: 10, y: 10, rot: 90 as const, locked: true };
    const inp = input([part('a', 500, 300, 4)], { locked: [[], [lockedPl]] });
    const r = nest(inp);
    expect(r.sheetCount).toBe(2);
    expect(r.layout.sheets[0]!.placements).toHaveLength(3);
    expect(r.layout.sheets[1]!.placements).toEqual([lockedPl]);
    expect(invariantViolations(inp, r)).toEqual([]);
  });

  it('freeform parts are nested by their arc-aware bounding box', () => {
    const project = load(mixed, (j) => {
      j.layout.sheets = [];
    });
    const inp = nestingInputFromProject(project, { toolDiameter: 6 });
    const arch = inp.parts.find((p) => p.id === 'arch-panel')!;
    expect(arch.w).toBeCloseTo(600, 9);
    expect(arch.h).toBeCloseTo(800, 9);
    const r = nest(inp);
    expect(invariantViolations(inp, r)).toEqual([]);
  });

  it('nestingInputFromProject keeps only locked placements and drops trailing empty sheets', () => {
    const project = load(shelfSet, (j) => {
      j.layout.sheets = [
        { placements: [{ partId: 'side', index: 0, x: 12, y: 12, rot: 0, locked: true }] },
        { placements: [{ partId: 'shelf', index: 0, x: 12, y: 12, rot: 0, locked: false }] },
      ];
    });
    const inp = nestingInputFromProject(project, { toolDiameter: 8 });
    expect(inp.locked).toEqual([
      [{ partId: 'side', index: 0, x: 12, y: 12, rot: 0, locked: true }],
    ]);
    // D-129: with tabs the effective clearance is Ø + 3.1 = 11.1 (stored 10); margin 12 ≥ Ø + 3
    expect(inp.gap).toBeCloseTo(11.1, 9);
    expect(inp.margin).toBe(12);
    expect(inp.mode).toBe('fastest');
  });

  it('weights from the mode preset; overrides only change the cost total', () => {
    const inp = input([part('a', 700, 300, 5), part('b', 300, 200, 7)]);
    const base = nest(inp);
    expect(base.cost.total).toBe(base.cost.wasteArea);
    const doubled = nest({ ...inp, weights: { waste: 2 } });
    expect(doubled.cost.total).toBe(2 * doubled.cost.wasteArea);
    expect(doubled.layout).toEqual(base.layout);
  });
});

describe('summarizeLayout', () => {
  it('matches the nesting result and lists unplaced copies', () => {
    const project = load(shelfSet, (j) => {
      j.parts.push({
        id: 'huge',
        name: 'huge',
        qty: 1,
        grainLock: false,
        kind: 'rect',
        params: { w: 5000, h: 100, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      });
    });
    const r = nestProject(project, { toolDiameter: 8 });
    const nested: Project = { ...project, layout: r.layout };
    const sum = summarizeLayout(nested);
    expect(sum.sheetCount).toBe(r.sheetCount);
    expect(sum.sheets).toEqual(r.sheets);
    expect(sum.wastePercent).toBe(r.wastePercent);
    expect(sum.unplaced).toEqual([{ partId: 'huge', index: 0 }]);
  });
});

describe('bins', () => {
  it('MaxRects: fills a 100 × 100 bin with four 50 × 50 squares, then nothing fits', () => {
    for (const rule of ['bssf', 'baf', 'bl'] as const) {
      const bin = new MaxRectsBin({ x: 0, y: 0, w: 100, h: 100 }, rule);
      for (let i = 0; i < 4; i++) {
        const fit = bin.find(50, 50);
        expect(fit).not.toBeNull();
        bin.occupy({ x: fit!.x, y: fit!.y, w: 50, h: 50 });
      }
      expect(bin.find(1, 1)).toBeNull();
    }
  });

  it('guillotine: obstacle in the middle leaves four disjoint strips', () => {
    const bin = new GuillotineBin({ x: 0, y: 0, w: 100, h: 100 }, 'bssf');
    bin.occupy({ x: 40, y: 40, w: 20, h: 20 });
    expect(bin.find(40, 100)).toMatchObject({ x: 0, y: 0 });
    expect(bin.find(41, 41)).toBeNull();
    expect(bin.find(20, 40)).not.toBeNull();
  });

  it('guillotine: corner placements fill the bin exactly', () => {
    const bin = new GuillotineBin({ x: 0, y: 0, w: 100, h: 100 }, 'baf');
    for (let i = 0; i < 4; i++) {
      const fit = bin.find(50, 50)!;
      bin.occupy({ x: fit.x, y: fit.y, w: 50, h: 50 });
    }
    expect(bin.find(1, 1)).toBeNull();
  });
});

describe('performance', () => {
  it('200 parts nest in under 2 s (Node)', () => {
    const parts: NestPart[] = [];
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 200; i++) {
      parts.push(
        part(
          `p${String(i).padStart(3, '0')}`,
          80 + Math.round(next() * 700),
          80 + Math.round(next() * 500),
          1,
          next() < 0.3,
        ),
      );
    }
    const t0 = Date.now();
    const r = nest(input(parts));
    const ms = Date.now() - t0;
    expect(r.unplaced).toEqual([]);
    expect(invariantViolations(input(parts), r)).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });
});

describe('invariant checker (guards the property tests against passing vacuously)', () => {
  it('flags overlap, too-small gap, outside, grain turn, lost and duplicated copies', () => {
    const inp = input([part('a', 100, 100, 3, true)]);
    const good = nest(inp);
    expect(invariantViolations(inp, good)).toEqual([]);
    const pls = good.layout.sheets[0]!.placements;
    const bad = (placements: typeof pls) => ({
      ...good,
      layout: { sheets: [{ placements }] },
    });
    const [a, b, c] = [pls[0]!, pls[1]!, pls[2]!];
    // Too close: 15 mm apart, 16 needed.
    expect(invariantViolations(inp, bad([a, { ...b, x: a.x + 115, y: a.y }, c]))).not.toEqual([]);
    // Outside the usable area.
    expect(invariantViolations(inp, bad([{ ...a, x: 5 }, b, c]))).not.toEqual([]);
    // Turned grain-locked part.
    expect(invariantViolations(inp, bad([{ ...a, rot: 90 }, b, c]))).not.toEqual([]);
    // Lost copy and duplicated copy.
    expect(invariantViolations(inp, bad([a, b]))).not.toEqual([]);
    expect(invariantViolations(inp, bad([a, b, c, c]))).not.toEqual([]);
  });
});
