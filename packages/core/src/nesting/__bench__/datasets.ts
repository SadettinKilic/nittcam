/**
 * Benchmark datasets for the placer (nesting-engine skill: track utilisation % over time).
 * Common workshop setup: 2800 × 2070 sheet, 8 mm gap, 10 mm margin, 8 mm tool.
 */
import type { NestingInput, NestPart } from '../types';

const base = {
  sheet: { width: 2800, height: 2070 },
  gap: 8,
  margin: 10,
  toolDiameter: 8,
  mode: 'minWaste' as const,
  locked: [],
};

const p = (id: string, w: number, h: number, qty: number, grainLock: boolean): NestPart => ({
  id,
  w,
  h,
  qty,
  grainLock,
});

/** A small kitchen: 4 base, 3 wall and 1 tall cabinet, doors and drawer fronts grain-locked. */
export const kitchenCabinets: NestingInput = {
  ...base,
  parts: [
    p('base-side', 560, 720, 8, true),
    p('base-bottom', 564, 560, 4, false),
    p('base-rail', 564, 100, 8, false),
    p('base-shelf', 564, 520, 4, false),
    p('wall-side', 320, 720, 6, true),
    p('wall-top-bottom', 564, 320, 6, false),
    p('wall-shelf', 564, 300, 6, false),
    p('tall-side', 560, 2000, 2, true),
    p('tall-shelf', 564, 540, 5, false),
    p('door', 596, 716, 7, true),
    p('drawer-front', 596, 176, 6, true),
    p('plinth', 2400, 100, 2, false),
  ],
};

/** Three bookcases like the shelf-set fixture. */
export const shelfSets: NestingInput = {
  ...base,
  parts: [
    p('side', 300, 1800, 6, true),
    p('shelf', 764, 280, 15, true),
    p('bottom', 764, 300, 3, true),
    p('top', 800, 300, 3, false),
  ],
};

/** 300 small parts (40–300 × 40–250 mm, a fifth grain-locked) from a fixed-seed LCG. */
export const manySmallParts: NestingInput = {
  ...base,
  parts: (() => {
    let seed = 20261117;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    return Array.from({ length: 300 }, (_, i) =>
      p(
        `s${String(i).padStart(3, '0')}`,
        40 + Math.round(next() * 260),
        40 + Math.round(next() * 210),
        1,
        next() < 0.2,
      ),
    );
  })(),
};

export const BENCH_DATASETS: readonly { name: string; input: NestingInput }[] = [
  { name: 'kitchen cabinets', input: kitchenCabinets },
  { name: 'shelf sets', input: shelfSets },
  { name: 'many small parts', input: manySmallParts },
];
