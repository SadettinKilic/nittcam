/** T120: CSV export and its round trip through the paste parser. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Part } from '../schema';
import { csvNumber, cutListToCsv, CUT_LIST_CSV_HEADER } from './export';
import { cutListToParts, headerField, parseCutList } from './parse';

function rect(over: Partial<Extract<Part, { kind: 'rect' }>> = {}): Part {
  return {
    id: 'a',
    name: 'Kapak',
    qty: 2,
    grain: { mode: 'fixed', angle: 30.5 },
    kind: 'rect',
    params: { w: 396.5, h: 716, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0.8, right: 2, bottom: 0, left: 1 },
    templates: [],
    note: 'Beyaz; "parlak"',
    ...over,
  };
}

/** The cut-list fields of a part (what a row can carry). */
function rowOf(p: Part) {
  if (p.kind !== 'rect') throw new Error('rect only');
  return {
    name: p.name,
    qty: p.qty,
    w: p.params.w,
    h: p.params.h,
    grain: p.grain,
    edgeBand: p.edgeBand,
    note: p.note ?? '',
  };
}

function reimport(text: string) {
  const result = parseCutList(text);
  expect(result.rows.flatMap((r) => r.errors)).toEqual([]);
  expect(result.unitAmbiguous).toBe(false);
  const ids = result.rows.map((_, i) => `n${i}`);
  return cutListToParts(result.rows, ids, 'mm').map((p) => ({
    name: p.name,
    qty: p.qty,
    w: p.params.w,
    h: p.params.h,
    grain: p.grain,
    edgeBand: p.edgeBand,
    note: p.note ?? '',
  }));
}

describe('cutListToCsv (T120)', () => {
  it('writes BOM, semicolons, decimal commas, CRLF and quotes', () => {
    const csv = cutListToCsv([rect()]);
    expect(csv.text.startsWith('\uFEFFAd;En (mm);Boy (mm);Adet;Damar;Damar açısı;')).toBe(true);
    expect(csv.text).toContain('\r\nKapak;396,5;716;2;evet;30,5;0,8;0;1;2;"Beyaz; ""parlak"""\r\n');
    expect(csv.rows).toBe(1);
  });

  it('every header is one the parser maps', () => {
    expect(CUT_LIST_CSV_HEADER.map((h) => headerField(h))).toEqual([
      'name',
      'w',
      'h',
      'qty',
      'grain',
      'grainAngle',
      'edgeTop',
      'edgeBottom',
      'edgeLeft',
      'edgeRight',
      'note',
    ]);
  });

  it('skips freeform parts and counts them', () => {
    const free: Part = {
      id: 'f',
      name: 'Serbest',
      qty: 1,
      grain: { mode: 'free', angle: 0 },
      kind: 'freeform',
      outline: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 0, y: 10, bulge: 0 },
      ],
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    };
    const csv = cutListToCsv([rect(), free]);
    expect(csv).toMatchObject({ rows: 1, skipped: 1 });
  });

  it('round trip: export → import gives the same parts', () => {
    const parts = [
      rect(),
      rect({ id: 'b', name: 'Raf', note: undefined, grain: { mode: 'free', angle: 0 } }),
    ];
    expect(reimport(cutListToCsv(parts).text)).toEqual(parts.map(rowOf));
  });

  it('property: export → import = same parts', () => {
    const mm = fc.integer({ min: 1, max: 3_000_000 }).map((n) => n / 1000);
    const band = fc.oneof(
      fc.constant(0),
      fc.integer({ min: 1, max: 5000 }).map((n) => n / 1000),
    );
    const text = fc
      .array(fc.constantFrom(...'abcçğıİöşüAZ09 ;"-_.,/'.split('')), { maxLength: 24 })
      .map((cs) => cs.join('').trim());
    const part = fc
      .record({
        name: text,
        qty: fc.integer({ min: 1, max: 999 }),
        w: mm,
        h: mm,
        mode: fc.constantFrom('free' as const, 'fixed' as const),
        angle: fc.integer({ min: 0, max: 179_999 }).map((n) => n / 1000),
        top: band,
        right: band,
        bottom: band,
        left: band,
        note: text,
      })
      .map((r, i = 0): Part =>
        rect({
          id: `p${i}`,
          name: r.name,
          qty: r.qty,
          params: { w: r.w, h: r.h, r: 0 },
          grain: { mode: r.mode, angle: r.angle },
          edgeBand: { top: r.top, right: r.right, bottom: r.bottom, left: r.left },
          note: r.note === '' ? undefined : r.note,
        }),
      );
    // T267: CI seed -1727248701 shrank to this part; the note ".0" made the import pick the
    // decimal dot, and "0,001" then came back as 1. Pinned so it runs on every pass.
    const seedCase: Part = rect({
      id: 'p0',
      name: '',
      qty: 1,
      grain: { mode: 'free', angle: 0 },
      params: { w: 0.001, h: 0.001, r: 0 },
      edgeBand: { top: 0, right: 0.001, bottom: 0, left: 0 },
      note: '.0',
    });
    fc.assert(
      fc.property(fc.array(part, { minLength: 1, maxLength: 20 }), (parts) => {
        expect(reimport(cutListToCsv(parts).text)).toEqual(parts.map(rowOf));
      }),
      { numRuns: 200, examples: [[[seedCase]]] },
    );
  });

  it('T267: small and large sizes survive a note with a decimal dot', () => {
    const parts = [
      rect({ id: 'a', params: { w: 0.5, h: 1234.25, r: 0 }, note: '1.5' }),
      rect({ id: 'b', params: { w: 123.456, h: 0.123, r: 0 }, note: 'v2.0' }),
      rect({ id: 'c', params: { w: 1.001, h: 999.999, r: 0 }, note: undefined }),
    ];
    expect(reimport(cutListToCsv(parts).text)).toEqual(parts.map(rowOf));
  });
});

describe('csvNumber (T267)', () => {
  it.each([
    [0.001, '0,0010'],
    [0.5, '0,5'],
    [123.456, '123,4560'],
    [1234.25, '1234,25'],
    [1234.567, '1234,567'],
    [716, '716'],
    [1000, '1000'],
    [0.8, '0,8'],
    [396.1234, '396,1230'],
  ])('%s → %s', (v, s) => {
    expect(csvNumber(v)).toBe(s);
  });

  it('never looks like one thousands group (d{1,3},ddd)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (n) => {
        expect(csvNumber(n / 1000)).not.toMatch(/^\d{1,3},\d{3}$/);
      }),
    );
  });
});

describe('parseCutList size limits (T267)', () => {
  it.each([
    ['0', 'NOT_POSITIVE'],
    ['-5', 'NOT_POSITIVE'],
    ['0,0005', 'TOO_SMALL'],
  ])('width %s is refused with %s', (raw, code) => {
    const result = parseCutList(`En;Boy;Adet\n${raw};100;1\n`);
    expect(result.rows[0]?.errors.map((e) => e.code)).toEqual([code]);
    expect(result.rows[0]?.values.w).toBeNull();
  });

  it('accepts exactly the smallest size', () => {
    const result = parseCutList('En;Boy;Adet\n0,0010;100;1\n');
    expect(result.rows[0]?.errors).toEqual([]);
    expect(result.rows[0]?.values.w).toBe(0.001);
  });
});

describe('cutListToCsv formula escape (spec §8.6)', () => {
  const base = {
    qty: 1,
    grain: { mode: 'free' as const, angle: 0 },
    kind: 'rect' as const,
    params: { w: 600, h: 400, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
  };
  const names = ['=1+1', '+x', '-y', '@SUM(1)', '\tz', "'=q", "'Ali", 'plain', '-'];

  it('escapes formula starts and round-trips every name', () => {
    const parts = names.map((name, i) => ({ ...base, id: `p${i}`, name, note: name }));
    const csv = cutListToCsv(parts).text;
    expect(csv).toContain("'=1+1");
    expect(csv).not.toContain("''Ali");
    const back = parseCutList(csv).rows.map((r) => r.values.name);
    expect(back).toEqual(names);
  });
});
