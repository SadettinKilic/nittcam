import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bandedEdges,
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
