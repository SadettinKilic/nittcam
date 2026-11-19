import { describe, expect, it } from 'vitest';
import { defaultSheet, sheetSizeOf, stockSheetSizes } from './sheet-size';
import type { Project } from './project';

const stock = (extra: Partial<Project['stock']> = {}): Project['stock'] => ({
  material: 'mdf',
  thickness: 18,
  sheet: { width: 2800, height: 2070, grain: 0 },
  useOffcuts: false,
  ...extra,
});

describe('sheet size helper (T164)', () => {
  it('absent stock.sheets = [stock.sheet] with no limit', () => {
    expect(stockSheetSizes({ stock: stock() })).toEqual([{ width: 2800, height: 2070 }]);
  });

  it('stock.sheets is returned in order, as copies', () => {
    const sheets = [
      { width: 2800, height: 2070, qty: 3 },
      { width: 1830, height: 3660 },
    ];
    const p = { stock: stock({ sheets }) };
    const out = stockSheetSizes(p);
    expect(out).toEqual(sheets);
    const first = out[0];
    if (first) first.width = 1;
    expect(sheets[0]?.width).toBe(2800);
  });

  it('a layout sheet without size uses stock.sheet; with size keeps the stock grain', () => {
    const p = {
      stock: stock(),
      layout: {
        sheets: [{ placements: [] }, { size: { width: 1830, height: 3660 }, placements: [] }],
      },
    };
    expect(sheetSizeOf(p, 0)).toBe(defaultSheet(p));
    expect(sheetSizeOf(p, 1)).toEqual({ width: 1830, height: 3660, grain: 0 });
    expect(sheetSizeOf(p, 7)).toBe(defaultSheet(p));
  });
});
