/** Tester B13 (T267): CSV export → import keeps small and large sizes; bad sizes are refused. */
import { describe, expect, it } from 'vitest';
import type { Part } from '../schema';
import { cutListToCsv } from './export';
import { parseCutList } from './parse';

function rect(id: string, w: number, h: number, note?: string): Part {
  return {
    id,
    name: `P${id}`,
    qty: 1,
    grain: { mode: 'free', angle: 0 },
    kind: 'rect',
    params: { w, h, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    note,
  };
}

function sizes(text: string) {
  const result = parseCutList(text);
  return {
    errors: result.rows.flatMap((r) => r.errors.map((e) => e.code)),
    wh: result.rows.map((r) => [r.values.w, r.values.h]),
    decimal: result.decimal,
  };
}

describe('T267 tester: 0,5 mm and 1234,25 mm round trip', () => {
  const notes = [undefined, '.0', '1.5', '1.234', 'v2.0', '0.001', 'a.b.c', '12.345.678'];

  it.each(notes)('note %s', (note) => {
    const parts = [
      rect('1', 0.5, 1234.25, note),
      rect('2', 1234.25, 0.5, note),
      rect('3', 0.001, 123.456, note),
      rect('4', 999.999, 1.001, note),
    ];
    const { text } = cutListToCsv(parts);
    // Readable as text with the Turkish decimal comma, no grouping dots in the numbers.
    expect(text).toContain(';0,5;1234,25;');
    expect(text).toContain(';1234,25;0,5;');
    expect(text).not.toMatch(/;1\.234,25;/);
    const back = sizes(text);
    expect(back.errors).toEqual([]);
    expect(back.wh).toEqual([
      [0.5, 1234.25],
      [1234.25, 0.5],
      [0.001, 123.456],
      [999.999, 1.001],
    ]);
  });

  it('many dot notes (dot wins the detection) still give the same sizes', () => {
    const parts = Array.from({ length: 6 }, (_, i) =>
      rect(String(i), i % 2 ? 0.5 : 0.123, 1234.25, `${i}.5`),
    );
    const back = sizes(cutListToCsv(parts).text);
    expect(back.errors).toEqual([]);
    expect(back.wh.map((r) => r[0])).toEqual([0.123, 0.5, 0.123, 0.5, 0.123, 0.5]);
  });

  it.each([
    ['0,0001', 'TOO_SMALL'],
    ['0,0009', 'TOO_SMALL'],
    ['0', 'NOT_POSITIVE'],
    ['-0,5', 'NOT_POSITIVE'],
  ])('height %s is refused (%s), never changed', (raw, code) => {
    const back = sizes(`En;Boy;Adet\n100;${raw};1\n`);
    expect(back.errors).toEqual([code]);
    expect(back.wh[0]?.[1]).toBeNull();
  });
});
