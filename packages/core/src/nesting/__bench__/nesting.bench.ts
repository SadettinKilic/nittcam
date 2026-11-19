/**
 * Placer benchmark: `pnpm --filter @nittcam/core bench:nesting`. Prints, per dataset and mode
 * (T162), the sheet count, utilisation %, the objective terms and the median run time (record the
 * numbers in the PR to track them over time).
 */
import { describe, expect, it } from 'vitest';
import { nest } from '../nest';
import type { NestingMode } from '../../schema';
import { BENCH_DATASETS } from './datasets';

const RUNS = 7;
const MODES: readonly NestingMode[] = ['minWaste', 'fastest', 'minToolChanges'];

describe('nesting benchmark', () => {
  it('prints utilisation %, objective terms and timing per dataset and mode', () => {
    const rows = BENCH_DATASETS.flatMap(({ name, input }) =>
      MODES.map((mode) => {
        const times: number[] = [];
        let r = nest({ ...input, mode });
        for (let i = 0; i < RUNS; i++) {
          const t0 = Date.now();
          r = nest({ ...input, mode });
          times.push(Date.now() - t0);
        }
        times.sort((a, b) => a - b);
        expect(r.unplaced).toEqual([]);
        return {
          dataset: name,
          mode,
          sheets: r.sheetCount,
          'utilisation %': Number(r.utilisationPercent.toFixed(2)),
          'waste m²': Number((r.cost.wasteArea / 1e6).toFixed(3)),
          'path m': Number((r.cost.cutLength / 1000).toFixed(2)),
          'tool changes': r.cost.toolChanges,
          winner: `${r.strategy.ordering} / ${r.strategy.heuristic}`,
          'median ms': times[Math.floor(RUNS / 2)],
        };
      }),
    );
    // Core has no DOM/Node typings; the console exists in the Vitest worker.
    (globalThis as unknown as { console: { table(data: unknown): void } }).console.table(rows);
  });
});
