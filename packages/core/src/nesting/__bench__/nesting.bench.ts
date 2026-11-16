/**
 * Placer benchmark: `pnpm --filter @nittcam/core bench:nesting`. Prints sheet count, utilisation %
 * and the median run time per dataset (record the numbers in the PR to track them over time).
 */
import { describe, expect, it } from 'vitest';
import { nest } from '../nest';
import { BENCH_DATASETS } from './datasets';

const RUNS = 15;

describe('nesting benchmark', () => {
  it('prints utilisation % and timing per dataset', () => {
    const rows = BENCH_DATASETS.map(({ name, input }) => {
      const times: number[] = [];
      let r = nest(input);
      for (let i = 0; i < RUNS; i++) {
        const t0 = Date.now();
        r = nest(input);
        times.push(Date.now() - t0);
      }
      times.sort((a, b) => a - b);
      expect(r.unplaced).toEqual([]);
      return {
        dataset: name,
        copies: input.parts.reduce((n, p) => n + p.qty, 0),
        sheets: r.sheetCount,
        'utilisation %': Number(r.utilisationPercent.toFixed(2)),
        'waste %': Number(r.wastePercent.toFixed(2)),
        'last sheet used %': Number((100 - (r.sheets.at(-1)?.wastePercent ?? 100)).toFixed(2)),
        winner: `${r.strategy.ordering} / ${r.strategy.heuristic}`,
        'median ms': times[Math.floor(RUNS / 2)],
      };
    });
    console.table(rows);
  });
});
