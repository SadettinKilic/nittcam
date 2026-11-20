import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bandedEdges,
  bulkParams,
  cutListSummary,
  formatInput,
  navColumns,
  navTarget,
  validateBand,
  validatePositive,
  validateQty,
} from './cut-list-grid';

const errors = { number: 'N', positive: 'P', qty: 'Q', band: 'B' };

describe('cut-list grid cells (T118)', () => {
  it('formats numbers with a decimal comma and parses them back', () => {
    expect(formatInput(396.5)).toBe('396,5');
    expect(validatePositive(errors, '396,5')).toEqual({ ok: true, value: 396.5 });
    expect(validatePositive(errors, '1.200,5')).toEqual({ ok: true, value: 1200.5 });
  });

  it('validates sizes, quantities and bands with the cell messages', () => {
    expect(validatePositive(errors, 'abc')).toEqual({ ok: false, error: 'N' });
    expect(validatePositive(errors, '0')).toEqual({ ok: false, error: 'P' });
    expect(validateQty(errors, '2,5')).toEqual({ ok: false, error: 'Q' });
    expect(validateQty(errors, '0')).toEqual({ ok: false, error: 'Q' });
    expect(validateQty(errors, '12')).toEqual({ ok: true, value: 12 });
    expect(validateBand(errors, '')).toEqual({ ok: true, value: 0 });
    expect(validateBand(errors, '-1')).toEqual({ ok: false, error: 'B' });
    expect(validateBand(errors, '0,8')).toEqual({ ok: true, value: 0.8 });
  });

  it('round-trips every positive size through the cell text', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_999_999 }), (n) => {
        const v = n / 1000;
        expect(validatePositive(errors, formatInput(v))).toEqual({ ok: true, value: v });
      }),
    );
  });

  it('lists the band columns: four per edge when wide, one Bant cell when compact', () => {
    expect(navColumns(true)).toEqual([
      'name',
      'w',
      'h',
      'qty',
      'grain',
      'edge-top',
      'edge-bottom',
      'edge-left',
      'edge-right',
      'note',
      'group',
      'actions',
    ]);
    expect(navColumns(false)).toContain('band');
    expect(navColumns(false)).not.toContain('edge-top');
  });

  it('banded edges in grid order', () => {
    expect(bandedEdges({ edgeBand: { top: 1, right: 0, bottom: 2, left: 0 } })).toEqual([
      'top',
      'bottom',
    ]);
  });
});

describe('cut-list grid navigation (T118)', () => {
  const cols = navColumns(false);
  it('arrows stop at the edges', () => {
    expect(navTarget(0, 'name', 'up', 3, cols)).toBeNull();
    expect(navTarget(0, 'name', 'left', 3, cols)).toBeNull();
    expect(navTarget(1, 'w', 'up', 3, cols)).toEqual({ row: 0, col: 'w' });
    expect(navTarget(1, 'w', 'right', 3, cols)).toEqual({ row: 1, col: 'h' });
    expect(navTarget(2, 'w', 'down', 3, cols)).toBeNull();
  });

  it('Enter on the last row asks for a new row in the same column', () => {
    expect(navTarget(2, 'qty', 'down', 3, cols, true)).toEqual({ append: true, col: 'qty' });
    expect(navTarget(1, 'qty', 'down', 3, cols, true)).toEqual({ row: 2, col: 'qty' });
  });

  it('Tab and Shift+Tab wrap between rows', () => {
    expect(navTarget(0, 'actions', 'next', 3, cols)).toEqual({ row: 1, col: 'name' });
    expect(navTarget(1, 'name', 'prev', 3, cols)).toEqual({ row: 0, col: 'actions' });
    expect(navTarget(2, 'actions', 'next', 3, cols)).toBeNull();
    expect(navTarget(0, 'name', 'prev', 3, cols)).toBeNull();
  });

  it('every move stays inside the grid', () => {
    const dir = fc.constantFrom('up', 'down', 'left', 'right', 'next', 'prev' as const);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.nat(),
        fc.nat(),
        dir,
        fc.boolean(),
        (rows, r, c, d, enter) => {
          const row = r % rows;
          const col = cols[c % cols.length] as string;
          const t = navTarget(row, col, d as never, rows, cols, enter);
          if (t === null) return;
          if ('append' in t) {
            expect(row).toBe(rows - 1);
            return;
          }
          expect(t.row).toBeGreaterThanOrEqual(0);
          expect(t.row).toBeLessThan(rows);
          expect(cols).toContain(t.col);
        },
      ),
    );
  });
});

describe('cut-list summary and bulk params (T119)', () => {
  const sheet = { width: 2800, height: 2070, grain: null };
  const rect = (id: string, w: number, h: number, qty: number, r = 0) =>
    ({
      id,
      name: id,
      qty,
      grain: { mode: 'free', angle: 0 },
      kind: 'rect',
      params: { w, h, r },
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    }) as const;

  it('matches a hand calculation: rows, pieces, m² and sheets inside the margin', () => {
    // 8 × 560 × 720 + 4 × 564 × 560 = 3 225 600 + 1 263 360 = 4 488 960 mm² = 4.48896 m².
    const s = cutListSummary({
      parts: [rect('a', 560, 720, 8), rect('b', 564, 560, 4)],
      stock: { material: 'mdf', thickness: 18, sheet, useOffcuts: false },
      nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    } as never);
    expect(s.rows).toBe(2);
    expect(s.pieces).toBe(12);
    expect(s.areaM2).toBeCloseTo(4.48896, 9);
    // Usable: 2780 × 2050 = 5 699 000 mm² → 1 sheet.
    expect(s.sheets).toBe(1);
  });

  it('a name-only row (no size yet) is a row but not a piece (P3)', () => {
    const s = cutListSummary({
      parts: [rect('a', 560, 720, 2), rect('b', 0, 0, 3)],
      stock: { material: 'mdf', thickness: 18, sheet, useOffcuts: false },
      nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    } as never);
    expect(s.rows).toBe(2);
    expect(s.pieces).toBe(2);
  });

  it('rounds the sheet estimate up and counts rounded corners', () => {
    const s = cutListSummary({
      parts: [rect('a', 1000, 1000, 6, 10)],
      stock: { material: 'mdf', thickness: 18, sheet, useOffcuts: false },
      nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    } as never);
    expect(s.areaM2).toBeCloseTo((6 * (1e6 - (4 - Math.PI) * 100)) / 1e6, 9);
    expect(s.sheets).toBe(2);
  });

  it('bulk params carry only the filled fields', () => {
    const edges = { top: null, right: null, bottom: null, left: null };
    const base = { qty: null, grain: '__keep__' as const, angle: 0, edges, prefix: '' };
    expect(bulkParams(['a'], base)).toBeNull();
    expect(
      bulkParams(['a', 'b'], {
        ...base,
        qty: 3,
        grain: 'fixed',
        angle: 30,
        edges: { ...edges, top: 0.8, left: 0 },
        prefix: 'Mutfak ',
      }),
    ).toEqual({
      ids: ['a', 'b'],
      qty: 3,
      grain: { mode: 'fixed', angle: 30 },
      edgeBand: { top: 0.8, left: 0 },
      namePrefix: 'Mutfak ',
    });
  });
});
