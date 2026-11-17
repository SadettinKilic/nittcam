/** T011b: per-edge band columns (named edges and the long/short convention), D-024. */
import { describe, expect, it } from 'vitest';
import {
  cutListToParts,
  headerField,
  longShortEdges,
  parseCutList,
  type CutListRow,
  type EdgeBandValues,
} from './index';

const band = (top: number, right: number, bottom: number, left: number): EdgeBandValues => ({
  top,
  right,
  bottom,
  left,
});
const bands = (rows: readonly CutListRow[]) => rows.map((r) => r.values.edgeBand);
const warningCodes = (text: string) => parseCutList(text).warnings.map((w) => w.code);

describe('header names for per-edge columns', () => {
  it.each([
    ['Üst bant', 'edgeTop'],
    ['Üst', 'edgeTop'],
    ['ÜST', 'edgeTop'],
    ['ust', 'edgeTop'],
    ['Top', 'edgeTop'],
    ['Üst kenar bandı (mm)', 'edgeTop'],
    ['Alt bant', 'edgeBottom'],
    ['Alt', 'edgeBottom'],
    ['Bottom', 'edgeBottom'],
    ['Sol bant', 'edgeLeft'],
    ['SOL', 'edgeLeft'],
    ['Left', 'edgeLeft'],
    ['Sağ bant', 'edgeRight'],
    ['Sağ', 'edgeRight'],
    ['Sag', 'edgeRight'],
    ['SAĞ', 'edgeRight'],
    ['Right', 'edgeRight'],
    ['Uzun1', 'edgeLong1'],
    ['Uzun 1', 'edgeLong1'],
    ['U1', 'edgeLong1'],
    ['u1', 'edgeLong1'],
    ['Uzun2', 'edgeLong2'],
    ['U2', 'edgeLong2'],
    ['Kısa1', 'edgeShort1'],
    ['KISA 1', 'edgeShort1'],
    ['Kisa1', 'edgeShort1'],
    ['K1', 'edgeShort1'],
    ['Kısa2', 'edgeShort2'],
    ['K2', 'edgeShort2'],
    // The single column keeps its meaning (all four edges).
    ['Bant', 'edge'],
    ['Kenar bandı', 'edge'],
    ['Edge', 'edge'],
  ])('%s → %s', (cell, field) => {
    expect(headerField(cell)).toBe(field);
  });

  it('existing size names are not taken by the edge names', () => {
    expect(headerField('Uzunluk')).toBe('h');
    expect(headerField('L')).toBe('h');
    expect(headerField('Boy')).toBe('h');
  });
});

describe('named edge columns', () => {
  it('Üst/Alt/Sol/Sağ in any order fill exactly their edge', () => {
    const r = parseCutList(
      'Ad\tEn\tBoy\tSağ\tÜst bant\tSol\tAlt\nKapak\t396\t716\t2\t0,8\t1\t0,4\nRaf\t564\t300\t\t\t\t',
    );
    expect(r.columns.fields).toEqual([
      'name',
      'w',
      'h',
      'edgeRight',
      'edgeTop',
      'edgeLeft',
      'edgeBottom',
    ]);
    expect(r.rows.every((row) => row.errors.length === 0)).toBe(true);
    expect(bands(r.rows)).toEqual([band(0.8, 2, 0.4, 1), band(0, 0, 0, 0)]);
    expect(r.warnings).toEqual([]);
  });

  it('English names; missing edges are 0', () => {
    const r = parseCutList('Name,Width,Height,Top,Left\nDoor,400,700,1,2');
    expect(bands(r.rows)).toEqual([band(1, 0, 0, 2)]);
  });

  it('a named edge does not depend on the orientation', () => {
    const r = parseCutList('En;Boy;Üst\n700;400;1\n400;700;1\n500;500;1');
    expect(bands(r.rows)).toEqual([band(1, 0, 0, 0), band(1, 0, 0, 0), band(1, 0, 0, 0)]);
  });
});

describe('long/short convention (U1, U2, K1, K2)', () => {
  const text = (w: number, h: number) =>
    `Ad\tEn\tBoy\tUzun1\tUzun2\tKısa1\tKısa2\nP\t${w}\t${h}\t1\t2\t3\t4`;

  it('landscape (w > h): long edges are top/bottom: U1 bottom, U2 top, K1 left, K2 right', () => {
    const r = parseCutList(text(700, 400));
    expect(r.columns.fields).toEqual([
      'name',
      'w',
      'h',
      'edgeLong1',
      'edgeLong2',
      'edgeShort1',
      'edgeShort2',
    ]);
    expect(bands(r.rows)).toEqual([band(2, 4, 1, 3)]);
  });

  it('portrait (w < h): long edges are left/right: U1 left, U2 right, K1 bottom, K2 top', () => {
    expect(bands(parseCutList(text(400, 700)).rows)).toEqual([band(4, 2, 3, 1)]);
  });

  it('square (w == h): w counts as the long side, so it maps like landscape', () => {
    expect(bands(parseCutList(text(500, 500)).rows)).toEqual([band(2, 4, 1, 3)]);
    expect(longShortEdges(500, 500)).toEqual(longShortEdges(700, 400));
  });

  it('each row uses its own orientation', () => {
    const r = parseCutList('En;Boy;U1;K2\n700;400;1;2\n400;700;1;2');
    expect(bands(r.rows)).toEqual([band(0, 2, 1, 0), band(2, 0, 0, 1)]);
  });

  it('short forms U1/U2/K1/K2 with decimals and empties', () => {
    const r = parseCutList('Ad;En;Boy;U1;U2;K1;K2\nKapak;396;716;0,8;0,8;;2');
    // Portrait: U1 left, U2 right, K1 bottom (empty → 0), K2 top.
    expect(bands(r.rows)).toEqual([band(2, 0.8, 0, 0.8)]);
  });

  it('orientation is the same in cm: the band follows the cm sizes before conversion', () => {
    const r = parseCutList('En;Boy;U1\n70;40;1');
    expect(r.unitAmbiguous).toBe(true);
    expect(bands(r.rows)).toEqual([band(0, 0, 1, 0)]);
    const [part] = cutListToParts(r.rows, ['a'], 'cm');
    expect(part?.params).toEqual({ w: 700, h: 400, r: 0 });
    expect(part?.edgeBand).toEqual(band(0, 0, 1, 0));
  });

  it('longShortEdges covers all four edges once, for any orientation', () => {
    for (const [w, h] of [
      [700, 400],
      [400, 700],
      [500, 500],
    ] as const) {
      expect(Object.values(longShortEdges(w, h)).sort()).toEqual([
        'bottom',
        'left',
        'right',
        'top',
      ]);
    }
  });
});

describe('single column and per-edge columns together', () => {
  it('single + per-edge: per-edge wins, the single column is ignored, warning shown', () => {
    const t = 'Ad\tEn\tBoy\tBant\tÜst\nKapak\t396\t716\t2\t0,8';
    const r = parseCutList(t);
    expect(r.columns.fields).toEqual(['name', 'w', 'h', 'edge', 'edgeTop']);
    expect(bands(r.rows)).toEqual([band(0.8, 0, 0, 0)]);
    expect(warningCodes(t)).toEqual(['EDGE_BAND_CONFLICT']);
  });

  it('single + long/short: per-edge wins too', () => {
    const t = 'En;Boy;Kenar bandı;U1\n700;400;2;1';
    expect(bands(parseCutList(t).rows)).toEqual([band(0, 0, 1, 0)]);
    expect(warningCodes(t)).toEqual(['EDGE_BAND_CONFLICT']);
  });

  it('an invalid value in the ignored single column is not an error', () => {
    const r = parseCutList('En;Boy;Bant;Sol\n700;400;abc;1');
    expect(r.rows[0]?.errors).toEqual([]);
    expect(bands(r.rows)).toEqual([band(0, 0, 0, 1)]);
  });

  it('named + long/short: the named edge wins on the same edge, warning shown', () => {
    // Landscape: U1 → bottom; "Alt" names bottom too and wins; K2 → right.
    const t = 'En;Boy;U1;K2;Alt\n700;400;1;2;0,4';
    expect(bands(parseCutList(t).rows)).toEqual([band(0, 2, 0.4, 0)]);
    expect(warningCodes(t)).toEqual(['EDGE_BAND_MIXED']);
  });

  it('single column alone still sets all four edges (D-018)', () => {
    const r = parseCutList('En;Boy;Bant\n700;400;0,8\n700;400;yok\n700;400;-');
    expect(bands(r.rows)).toEqual([band(0.8, 0.8, 0.8, 0.8), band(0, 0, 0, 0), band(0, 0, 0, 0)]);
    expect(r.warnings).toEqual([]);
  });

  it('manual mapping can turn a column into a per-edge column', () => {
    const r = parseCutList('A\t100\t200\t1\t2', {
      columns: ['name', 'w', 'h', 'edgeLong1', 'edgeShort2'],
    });
    // Portrait: U1 → left, K2 → top.
    expect(bands(r.rows)).toEqual([band(2, 0, 0, 1)]);
  });
});

describe('invalid per-edge values', () => {
  it.each(['x', 'var', 'yok', '-', 'evet', '1mm', '-1'])(
    '"%s" is a row error (numbers only)',
    (value) => {
      const r = parseCutList(`Ad;En;Boy;Üst;U1\nA;700;400;${value};1`);
      const row = r.rows[0];
      expect(row?.errors).toEqual([
        {
          col: 3,
          field: 'edgeTop',
          code: 'INVALID_EDGE_BAND',
          message: 'edge band must be a thickness in mm (0 or more)',
        },
      ]);
    },
  );

  it('the error names the long/short field and column; the row is skipped by cutListToParts', () => {
    const r = parseCutList('Ad;En;Boy;K1\nA;700;400;abc\nB;700;400;1');
    expect(r.rows[0]?.errors.map((e) => [e.col, e.field, e.code])).toEqual([
      [3, 'edgeShort1', 'INVALID_EDGE_BAND'],
    ]);
    const parts = cutListToParts(r.rows, ['b'], 'mm');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.edgeBand).toEqual(band(0, 0, 0, 1));
  });

  it('accepts "0,8", "1", "2", "0" and grouped forms; empty is 0', () => {
    const r = parseCutList('En;Boy;Üst;Alt;Sol;Sağ\n700;400;0,8;1;2;\n700;400;0;;;0,4');
    expect(r.rows.every((row) => row.errors.length === 0)).toBe(true);
    expect(bands(r.rows)).toEqual([band(0.8, 0, 1, 2), band(0, 0.4, 0, 0)]);
  });
});
