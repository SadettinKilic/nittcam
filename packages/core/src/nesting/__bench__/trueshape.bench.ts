/**
 * True-shape vs rotated-bbox benchmark (T167): `pnpm --filter @nittcam/core bench:nesting`.
 * Per dataset: sheets, utilisation by the parts' own outline area (same measure for both
 * engines) and the run time. Record the numbers in the PR.
 */
import { describe, expect, it } from 'vitest';
import { signedArea } from '../../geometry/polyline';
import { nest } from '../nest';
import type { NestingEngine, NestingInput } from '../types';
import { TRUE_SHAPE_DATASETS } from './datasets';

function ownUtilisation(input: NestingInput, engine: NestingEngine) {
  const t0 = Date.now();
  const r = nest({ ...input, engine });
  const ms = Date.now() - t0;
  const area = new Map(
    input.parts.map((p) => [p.id, p.outline ? Math.abs(signedArea(p.outline)) : p.w * p.h]),
  );
  let parts = 0;
  for (const sh of r.layout.sheets)
    for (const pl of sh.placements) parts += area.get(pl.partId) ?? 0;
  const sheets = r.sheetArea;
  return { r, ms, util: sheets > 0 ? (100 * parts) / sheets : 0 };
}

describe('true-shape benchmark', () => {
  it('prints utilisation gain of true-shape over the rotated-bbox fallback', () => {
    const rows = TRUE_SHAPE_DATASETS.map(({ name, input }) => {
      const box = ownUtilisation(input, 'maxrects');
      const shape = ownUtilisation(input, 'trueShape');
      expect(shape.r.unplaced).toEqual([]);
      expect(shape.ms).toBeLessThan(10_000);
      return {
        dataset: name,
        'bbox sheets': box.r.sheetCount,
        'bbox util %': Number(box.util.toFixed(2)),
        'true-shape sheets': shape.r.sheetCount,
        'true-shape util %': Number(shape.util.toFixed(2)),
        'gain pp': Number((shape.util - box.util).toFixed(2)),
        'true-shape ms': shape.ms,
      };
    });
    (globalThis as unknown as { console: { table(data: unknown): void } }).console.table(rows);
  });
});
