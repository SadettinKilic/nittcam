/**
 * Cut order benchmark (T016, D-023): `pnpm --filter @nittcam/core bench:order`. Nests the placer
 * benchmark datasets, builds the toolpath in every mode and prints the rapid length (XY, from the
 * sheet origin through every start point) of the placement order (T014), the naive constrained
 * order and the optimised order, plus the median build time. Not part of `pnpm test`.
 */
import { describe, expect, it } from 'vitest';
import { nest } from '../../nesting/nest';
import { BENCH_DATASETS } from '../../nesting/__bench__/datasets';
import type { Project } from '../../schema';
import { buildToolpath } from '../build';
import { machineOf, projectOf } from '../toolpath.testing';

const RUNS = 5;
const MODES = ['minWaste', 'fastest', 'minToolChanges'] as const;

describe('cut order benchmark', () => {
  it('prints rapid lengths naive vs optimised per dataset and mode', () => {
    const rows = BENCH_DATASETS.flatMap(({ name, input }) => {
      const nested = nest(input);
      const base = projectOf({
        parts: input.parts.map((p) => ({ id: p.id, w: p.w, h: p.h, qty: p.qty })),
        sheet: input.sheet,
        gap: input.gap,
        margin: input.margin,
      });
      const machine = machineOf({ toolDiameter: input.toolDiameter });
      return MODES.map((mode) => {
        const project: Project = {
          ...base,
          parts: base.parts.map((p, i) => ({
            ...p,
            grainLock: input.parts[i]?.grainLock ?? false,
          })),
          nesting: { ...base.nesting, mode },
          layout: nested.layout,
        };
        const times: number[] = [];
        let res = buildToolpath(project, machine);
        for (let i = 0; i < RUNS; i++) {
          const t0 = Date.now();
          res = buildToolpath(project, machine);
          times.push(Date.now() - t0);
        }
        times.sort((a, b) => a - b);
        expect(res.order.rapid).toBeLessThanOrEqual(res.order.naiveRapid + 1e-6);
        const m = (x: number) => Number((x / 1000).toFixed(2));
        return {
          dataset: name,
          mode,
          ops: res.toolpath.operations.length,
          'placement order m': m(res.order.placementRapid),
          'naive (rules) m': m(res.order.naiveRapid),
          'optimised m': m(res.order.rapid),
          'vs naive %': Number((100 * (1 - res.order.rapid / res.order.naiveRapid)).toFixed(1)),
          'median ms': times[Math.floor(RUNS / 2)],
        };
      });
    });
    (globalThis as unknown as { console: { table(data: unknown): void } }).console.table(rows);
  }, 600_000);
});
