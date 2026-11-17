/** T011b tester: workshop pastes with per-edge columns, precedence, no-band marks, round trip. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cutListToParts, parseCutList } from './index';

const e = (top: number, right: number, bottom: number, left: number) => ({
  top,
  right,
  bottom,
  left,
});
const bandsOf = (text: string) => parseCutList(text).rows.map((r) => r.values.edgeBand);
const codes = (text: string) => parseCutList(text).warnings.map((w) => w.code);

const WORKSHOP = [
  'Parça\tEn\tBoy\tAdet\tUzun1\tUzun2\tKısa1\tKısa2',
  'Kapak\t716\t396\t2\t0,8\t0,4\t1\t2', // landscape
  'Yan\t400\t720\t2\t0,8\t0,4\t1\t2', // portrait
  'Kare\t500\t500\t1\t0,8\t0,4\t1\t2', // square (w is the long side)
].join('\n');

describe('T011b workshop paste with Turkish decimals', () => {
  it('maps U1/U2/K1/K2 per row orientation', () => {
    const r = parseCutList(WORKSHOP);
    expect(r.rows.every((x) => x.errors.length === 0)).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.columns.fields).toEqual([
      'name',
      'w',
      'h',
      'qty',
      'edgeLong1',
      'edgeLong2',
      'edgeShort1',
      'edgeShort2',
    ]);
    const [land, port, sq] = bandsOf(WORKSHOP);
    // landscape: U1 bottom 0.8, U2 top 0.4, K1 left 1, K2 right 2
    expect(land).toEqual(e(0.4, 2, 0.8, 1));
    // portrait: U1 left 0.8, U2 right 0.4, K1 bottom 1, K2 top 2
    expect(port).toEqual(e(2, 0.4, 1, 0.8));
    // square counts as landscape
    expect(sq).toEqual(e(0.4, 2, 0.8, 1));
  });

  it('works with semicolon CSV and decimal dots too', () => {
    const csv = 'Ad;En;Boy;Adet;U1;K1\nA;300;600;1;0.8;1';
    const r = parseCutList(csv, { decimal: 'dot' });
    expect(r.rows[0]?.errors).toEqual([]);
    expect(r.rows[0]?.values.edgeBand).toEqual(e(0, 0, 1, 0.8));
  });
});

describe('T011b precedence', () => {
  it('named beats U/K on the same edge, with EDGE_BAND_MIXED; other edges keep U/K', () => {
    // landscape: U1 → bottom 1, K2 → right 2; named Alt = 0,5 overrides bottom
    const text = 'Ad\tEn\tBoy\tU1\tK2\tAlt\nA\t700\t300\t1\t2\t0,5';
    expect(codes(text)).toContain('EDGE_BAND_MIXED');
    expect(bandsOf(text)[0]).toEqual(e(0, 2, 0.5, 0));
  });

  it('named empty cell still wins with 0 over a U/K value on that edge', () => {
    const text = 'Ad\tEn\tBoy\tU1\tAlt\nA\t700\t300\t1\t';
    expect(bandsOf(text)[0]).toEqual(e(0, 0, 0, 0));
  });

  it('single Bant + per-edge: single ignored entirely, EDGE_BAND_CONFLICT', () => {
    const text = 'Ad\tEn\tBoy\tBant\tSol\nA\t700\t300\t1\t0,8';
    expect(codes(text)).toContain('EDGE_BAND_CONFLICT');
    expect(bandsOf(text)[0]).toEqual(e(0, 0, 0, 0.8));
  });

  it('single Bant + U/K: single ignored, conflict warning', () => {
    const text = 'Ad\tEn\tBoy\tBant\tK1\nA\t700\t300\t1\t2';
    expect(codes(text)).toContain('EDGE_BAND_CONFLICT');
    expect(bandsOf(text)[0]).toEqual(e(0, 0, 0, 2));
  });

  it('single Bant alone applies to all four edges, no warning', () => {
    const text = 'Ad\tEn\tBoy\tBant\nA\t700\t300\t0,8';
    expect(codes(text)).toEqual([]);
    expect(bandsOf(text)[0]).toEqual(e(0.8, 0.8, 0.8, 0.8));
  });
});

describe('T011b per-edge cell values', () => {
  it.each(['-', '–', 'yok', 'YOK', 'Yok', ''])('"%s" → 0 without an error', (cell) => {
    const r = parseCutList(`Ad\tEn\tBoy\tÜst\tSağ\nA\t700\t300\t${cell}\t1`);
    expect(r.rows[0]?.errors).toEqual([]);
    expect(r.rows[0]?.values.edgeBand).toEqual(e(0, 1, 0, 0));
  });

  it.each(['x', 'var', '1mm', '-1', 'evet', 'abc'])('"%s" → INVALID_EDGE_BAND', (cell) => {
    const r = parseCutList(`Ad\tEn\tBoy\tÜst\nA\t700\t300\t${cell}`);
    const errs = r.rows[0]?.errors ?? [];
    expect(errs.map((x) => x.code)).toEqual(['INVALID_EDGE_BAND']);
    expect(errs[0]?.field).toBe('edgeTop');
    expect(cutListToParts(r.rows, [], 'mm')).toEqual([]);
  });

  it('an invalid U/K cell reports the long/short field', () => {
    const r = parseCutList('Ad\tEn\tBoy\tU2\nA\t700\t300\tvar');
    expect(r.rows[0]?.errors[0]).toMatchObject({ code: 'INVALID_EDGE_BAND', field: 'edgeLong2' });
  });

  it('header spelling variants: case, diacritics, bant/bandı/kenar, Sag', () => {
    const text = 'Ad\tEn\tBoy\tÜST BANT\talt bandı\tSOL KENAR\tSag\nA\t700\t300\t1\t2\t3\t4';
    expect(bandsOf(text)[0]).toEqual(e(1, 4, 2, 3));
    const en = 'Ad\tEn\tBoy\tTOP\tbottom\tLeft\tRIGHT\nA\t700\t300\t1\t2\t3\t4';
    expect(bandsOf(en)[0]).toEqual(e(1, 4, 2, 3));
  });
});

describe('T011b round trip: parse → parts', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

  it('rotating the row (w/h swapped) re-maps U/K to the other edges, named edges stay', () => {
    const land = parseCutList('Ad\tEn\tBoy\tU1\tU2\tK1\tK2\nA\t700\t300\t1\t2\t3\t4');
    const port = parseCutList('Ad\tEn\tBoy\tU1\tU2\tK1\tK2\nA\t300\t700\t1\t2\t3\t4');
    const [pl] = cutListToParts(land.rows, ids(1), 'mm');
    const [pp] = cutListToParts(port.rows, ids(1), 'mm');
    expect(pl?.edgeBand).toEqual(e(2, 4, 1, 3));
    expect(pp?.edgeBand).toEqual(e(4, 2, 3, 1));
    // The same physical long edge pair keeps its thickness: U1/U2 sit on the long sides in both.
    expect(pl?.params).toMatchObject({ w: 700, h: 300 });
    expect(pp?.params).toMatchObject({ w: 300, h: 700 });

    const named = (w: number, h: number) =>
      cutListToParts(
        parseCutList(`Ad\tEn\tBoy\tÜst\tAlt\tSol\tSağ\nA\t${w}\t${h}\t1\t2\t3\t4`).rows,
        ids(1),
        'mm',
      )[0]?.edgeBand;
    expect(named(700, 300)).toEqual(named(300, 700));
  });

  it('property: the long edges (U1,U2) always carry the U values, the short edges the K values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 5, max: 9 }),
        (w, h, u, k) => {
          const r = parseCutList(
            `Ad\tEn\tBoy\tU1\tU2\tK1\tK2\nA\t${w}\t${h}\t${u}\t${u}\t${k}\t${k}`,
          );
          const b = cutListToParts(r.rows, ['x'], 'mm')[0]?.edgeBand;
          if (!b) return false;
          // long edges are parallel to the longer dimension (w ≥ h → top/bottom)
          const long = w >= h ? [b.top, b.bottom] : [b.left, b.right];
          const short = w >= h ? [b.left, b.right] : [b.top, b.bottom];
          return long.every((v) => v === u) && short.every((v) => v === k);
        },
      ),
    );
  });
});
