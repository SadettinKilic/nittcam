import { describe, expect, it } from 'vitest';
import {
  cutListToParts,
  headerField,
  parseCutList,
  parseCutListNumber,
  toMillimetres,
  type CutListRow,
} from './index';

const values = (rows: readonly CutListRow[]) => rows.map((r) => r.values);
const codes = (row: CutListRow | undefined) => row?.errors.map((e) => e.code);

describe('parseCutListNumber', () => {
  it.each([
    ['396', 'comma', 396],
    ['396,5', 'comma', 396.5],
    ['396.5', 'comma', 396.5],
    ['1.220', 'comma', 1220],
    ['1.220', 'dot', 1.22],
    ['1,220', 'dot', 1220],
    ['1,220', 'comma', 1.22],
    ['1.220,5', 'comma', 1220.5],
    ['1.220,5', 'dot', 1220.5],
    ['1,220.5', 'comma', 1220.5],
    ['1.220.000', 'dot', 1220000],
    ['2 440', 'comma', 2440],
    ['2\u00a0440,5', 'comma', 2440.5],
    [',5', 'comma', 0.5],
    ['-3', 'comma', -3],
  ] as const)('%s (%s) → %d', (raw, decimal, expected) => {
    expect(parseCutListNumber(raw, decimal)).toBe(expected);
  });

  it.each(['', 'abc', '12a', '1 2', '1,2,3', '12 mm', '1..2'])('"%s" is not a number', (raw) => {
    expect(parseCutListNumber(raw, 'comma')).toBeNull();
  });
});

describe('headerField', () => {
  it.each([
    ['Ad', 'name'],
    ['İsim', 'name'],
    ['Parça', 'name'],
    ['PARÇA ADI', 'name'],
    ['Name', 'name'],
    ['En', 'w'],
    ['Genişlik (mm)', 'w'],
    ['Width', 'w'],
    ['Boy', 'h'],
    ['Yükseklik', 'h'],
    ['Height', 'h'],
    ['Length', 'h'],
    ['Boy cm', 'h'],
    ['Adet', 'qty'],
    ['Qty', 'qty'],
    ['Miktar', 'qty'],
    ['Damar', 'grain'],
    ['Damar yönü', 'grain'],
    ['Grain', 'grain'],
    ['Bant', 'edge'],
    ['Kenar bandı', 'edge'],
    ['Edge', 'edge'],
  ] as const)('%s → %s', (cell, field) => {
    expect(headerField(cell)).toBe(field);
  });

  it('unknown names give null', () => {
    expect(headerField('Renk')).toBeNull();
    expect(headerField('')).toBeNull();
  });
});

describe('parseCutList: delimiters and quotes', () => {
  it('tab (Excel copy) with a Turkish header and decimal comma', () => {
    const r = parseCutList('Ad\tEn\tBoy\tAdet\nKapak\t396,5\t716\t4\nRaf\t564\t300\t2\n');
    expect(r.delimiter).toBe('\t');
    expect(r.hasHeader).toBe(true);
    expect(r.header).toEqual(['Ad', 'En', 'Boy', 'Adet']);
    expect(r.columns).toEqual({
      fields: ['name', 'w', 'h', 'qty'],
      source: 'header',
      confidence: 'high',
    });
    expect(values(r.rows)).toEqual([
      { name: 'Kapak', w: 396.5, h: 716, qty: 4, grainLock: false, edgeBand: 0 },
      { name: 'Raf', w: 564, h: 300, qty: 2, grainLock: false, edgeBand: 0 },
    ]);
    expect(r.rows.map((row) => row.line)).toEqual([2, 3]);
    expect(r.unitAmbiguous).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('semicolon with decimal comma (Turkish CSV)', () => {
    const r = parseCutList('Kapak;396,5;716;4\r\nRaf;564;300;2');
    expect(r.delimiter).toBe(';');
    expect(r.decimal).toBe('comma');
    expect(r.hasHeader).toBe(false);
    expect(values(r.rows).map((v) => [v.name, v.w, v.h, v.qty])).toEqual([
      ['Kapak', 396.5, 716, 4],
      ['Raf', 564, 300, 2],
    ]);
  });

  it('comma with an English header and decimal dots', () => {
    const r = parseCutList('Name,Width,Height,Qty\nDoor,396.5,716,4\nShelf,564,300,2');
    expect(r.delimiter).toBe(',');
    expect(r.decimal).toBe('dot');
    expect(r.columns.fields).toEqual(['name', 'w', 'h', 'qty']);
    expect(values(r.rows).map((v) => v.w)).toEqual([396.5, 564]);
  });

  it('quoted cells keep delimiters, quotes and newlines', () => {
    const text =
      'Ad,En,Boy\n"Kapak, sol","396,5",716\n"Raf ""orta""",564,300\n"Çok\nsatırlı",100,200';
    const r = parseCutList(text);
    expect(r.delimiter).toBe(',');
    expect(values(r.rows).map((v) => [v.name, v.w, v.h])).toEqual([
      ['Kapak, sol', 396.5, 716],
      ['Raf "orta"', 564, 300],
      ['Çok\nsatırlı', 100, 200],
    ]);
    expect(r.rows.map((row) => row.line)).toEqual([2, 3, 4]);
  });

  it('tab wins over semicolon and comma inside cells', () => {
    const r = parseCutList('Kapak; sol\t396,5\t716\nRaf, orta\t564\t300');
    expect(r.delimiter).toBe('\t');
    expect(values(r.rows).map((v) => v.name)).toEqual(['Kapak; sol', 'Raf, orta']);
  });

  it('skips empty lines and trims cells; a BOM is ignored', () => {
    const r = parseCutList('\uFEFF\n  Kapak ; 396 ; 716 \n\n;;\nRaf;564;300\n\n');
    expect(values(r.rows).map((v) => [v.name, v.w, v.h])).toEqual([
      ['Kapak', 396, 716],
      ['Raf', 564, 300],
    ]);
  });

  it('a forced delimiter overrides detection', () => {
    const r = parseCutList('a,b;1;2', { delimiter: ';' });
    expect(r.rows[0]?.cells).toEqual(['a,b', '1', '2']);
  });

  it('no delimiter → one cell per row and a warning', () => {
    const r = parseCutList('Kapak\nRaf');
    expect(r.delimiter).toBeNull();
    expect(r.warnings.map((w) => w.code)).toContain('NO_DELIMITER');
    expect(codes(r.rows[0])).toEqual(['MISSING_COLUMN', 'MISSING_COLUMN']);
  });

  it('empty text → no rows and an EMPTY warning', () => {
    const r = parseCutList('  \n\t\n');
    expect(r.rows).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['EMPTY']);
  });
});

describe('parseCutList: decimals and thousands', () => {
  it('thousands dot with a decimal comma elsewhere is unambiguous', () => {
    const r = parseCutList('Yan;1.220;396,5\nArka;2.440;564');
    expect(values(r.rows).map((v) => [v.w, v.h])).toEqual([
      [1220, 396.5],
      [2440, 564],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('only 1.220-style numbers: read as thousands with a warning', () => {
    const r = parseCutList('Yan;1.220;2.440');
    expect(values(r.rows)[0]).toMatchObject({ w: 1220, h: 2440 });
    expect(r.warnings.map((w) => w.code)).toEqual(['THOUSANDS_ASSUMED']);
  });

  it('a decimal dot elsewhere makes 1.250 a decimal', () => {
    const r = parseCutList('a,1.250,10.5');
    expect(r.decimal).toBe('dot');
    expect(values(r.rows)[0]).toMatchObject({ w: 1.25, h: 10.5 });
  });

  it('mixed decimal comma and dot → warning', () => {
    const r = parseCutList('a;396,5;716.5');
    expect(r.warnings.map((w) => w.code)).toContain('MIXED_DECIMALS');
    expect(values(r.rows)[0]).toMatchObject({ w: 396.5, h: 716.5 });
  });

  it('a forced decimal separator is used', () => {
    const r = parseCutList('a;1.220;300', { decimal: 'dot' });
    expect(values(r.rows)[0]).toMatchObject({ w: 1.22, h: 300 });
    expect(r.warnings).toEqual([]);
  });
});

describe('parseCutList: header and mapping', () => {
  it('English header with grain and edge columns, columns in another order', () => {
    const r = parseCutList(
      'Qty\tLength\tWidth\tName\tGrain\tEdge\n2\t716\t396\tDoor\tyes\t0.8\n1\t300\t564\tShelf\tno\t',
    );
    expect(r.columns.fields).toEqual(['qty', 'h', 'w', 'name', 'grain', 'edge']);
    expect(values(r.rows)).toEqual([
      { name: 'Door', w: 396, h: 716, qty: 2, grainLock: true, edgeBand: 0.8 },
      { name: 'Shelf', w: 564, h: 300, qty: 1, grainLock: false, edgeBand: 0 },
    ]);
  });

  it('Turkish header with units, unknown columns ignored, duplicates keep the first', () => {
    const r = parseCutList(
      'Parça adı;Renk;Genişlik (mm);Yükseklik (mm);Miktar;En\nKapak;beyaz;396;716;4;9',
    );
    expect(r.columns.fields).toEqual(['name', 'ignore', 'w', 'h', 'qty', 'ignore']);
    expect(r.headerUnit).toBe('mm');
    expect(values(r.rows)[0]).toMatchObject({ name: 'Kapak', w: 396, h: 716, qty: 4 });
  });

  it('Turkish grain words and edge band "yok"', () => {
    const r = parseCutList(
      'Ad;En;Boy;Damar;Bant\nA;100;200;evet;yok\nB;100;200;hayır;2\nC;100;200;x;0,4\nD;100;200;;',
    );
    expect(values(r.rows).map((v) => [v.grainLock, v.edgeBand])).toEqual([
      [true, 0],
      [false, 2],
      [true, 0.4],
      [false, 0],
    ]);
  });

  it('missing qty column or empty qty → 1', () => {
    const noCol = parseCutList('Ad;En;Boy\nKapak;396;716');
    expect(values(noCol.rows)[0]?.qty).toBe(1);
    const empty = parseCutList('Ad;En;Boy;Adet\nKapak;396;716;');
    expect(values(empty.rows)[0]?.qty).toBe(1);
  });

  it('header without width → low confidence, a warning and row errors', () => {
    const r = parseCutList('Ad;Boy\nKapak;716');
    expect(r.columns.confidence).toBe('low');
    expect(r.warnings.map((w) => w.code)).toContain('MISSING_WIDTH_COLUMN');
    expect(r.rows[0]?.errors).toEqual([
      { col: null, field: 'w', code: 'MISSING_COLUMN', message: expect.any(String) },
    ]);
  });

  it('no header: guesses (name, w, h, qty) by position with high confidence', () => {
    const r = parseCutList('Kapak\t396,5\t716\t4\nRaf\t564\t300\t2');
    expect(r.hasHeader).toBe(false);
    expect(r.columns).toEqual({
      fields: ['name', 'w', 'h', 'qty'],
      source: 'position',
      confidence: 'high',
    });
  });

  it('no header and no name column: (w, h, qty)', () => {
    const r = parseCutList('396\t716\t4\n564\t300\t2');
    expect(r.columns.fields).toEqual(['w', 'h', 'qty']);
    expect(r.columns.confidence).toBe('high');
  });

  it('no header with a non-integer third number: qty not guessed, low confidence', () => {
    const r = parseCutList('A;396;716;0,8\nB;564;300;2');
    expect(r.columns.fields).toEqual(['name', 'w', 'h', 'ignore']);
    expect(r.columns.confidence).toBe('low');
  });

  it('no header: a grain-word column is mapped to grain', () => {
    const r = parseCutList('A;396;716;2;evet\nB;564;300;1;hayır');
    expect(r.columns.fields).toEqual(['name', 'w', 'h', 'qty', 'grain']);
  });

  it('forced hasHeader=false keeps the first row as data (and reports its errors)', () => {
    const r = parseCutList('Ad;En;Boy\nKapak;396;716', {
      hasHeader: false,
      columns: ['name', 'w', 'h'],
    });
    expect(r.rows).toHaveLength(2);
    expect(codes(r.rows[0])).toEqual(['INVALID_NUMBER', 'INVALID_NUMBER']);
  });

  it('manual mapping overrides the header; a duplicate field warns', () => {
    const r = parseCutList('Ad;En;Boy\nKapak;396;716', { columns: ['name', 'h', 'h'] });
    expect(r.columns).toEqual({
      fields: ['name', 'h', 'ignore'],
      source: 'manual',
      confidence: 'high',
    });
    expect(r.warnings.map((w) => w.code)).toEqual(['DUPLICATE_COLUMN', 'MISSING_WIDTH_COLUMN']);
    expect(values(r.rows)[0]?.h).toBe(396);
  });

  it('a short manual mapping is padded with ignore', () => {
    const r = parseCutList('Kapak;396;716;4', { columns: ['name', 'w', 'h'] });
    expect(r.columns.fields).toEqual(['name', 'w', 'h', 'ignore']);
    expect(values(r.rows)[0]?.qty).toBe(1);
  });
});

describe('parseCutList: invalid rows', () => {
  it('reports each bad cell with column, field and code; other rows stay valid', () => {
    const text = [
      'Ad;En;Boy;Adet;Damar;Bant',
      'İyi;396;716;2;evet;1',
      'Boş en;;716;1;;',
      'Harf;abc;716;1;;',
      'Sıfır;0;-5;1;;',
      'Adet;396;716;1,5;;',
      'Adet0;396;716;0;;',
      'Damar;396;716;1;belki;',
      'Bant;396;716;1;;kalın',
      'Eksik;396',
    ].join('\n');
    const r = parseCutList(text);
    expect(r.rows.map((row) => [row.values.name, codes(row)])).toEqual([
      ['İyi', []],
      ['Boş en', ['REQUIRED']],
      ['Harf', ['INVALID_NUMBER']],
      ['Sıfır', ['NOT_POSITIVE', 'NOT_POSITIVE']],
      ['Adet', ['INVALID_QTY']],
      ['Adet0', ['INVALID_QTY']],
      ['Damar', ['INVALID_GRAIN']],
      ['Bant', ['INVALID_EDGE_BAND']],
      ['Eksik', ['REQUIRED']],
    ]);
    expect(r.rows[2]?.errors[0]).toMatchObject({ col: 1, field: 'w' });
    expect(r.rows[8]?.cells).toEqual(['Eksik', '396', '', '', '', '']);
    for (const row of r.rows)
      for (const e of row.errors) expect(e.message.length).toBeGreaterThan(0);
  });
});

describe('parseCutList: unit', () => {
  it('all sizes below 100 → unitAmbiguous', () => {
    expect(parseCutList('Kapak;39,6;71,6;2').unitAmbiguous).toBe(true);
  });

  it('one size of 100 or more → not ambiguous', () => {
    expect(parseCutList('Kapak;39,6;71,6\nYan;56;120').unitAmbiguous).toBe(false);
  });

  it('a "(cm)" header is ambiguous even with large values; "(mm)" never is', () => {
    expect(parseCutList('Ad;En (cm);Boy (cm)\nA;396;716').unitAmbiguous).toBe(true);
    expect(parseCutList('Ad;En (cm);Boy (cm)\nA;396;716').headerUnit).toBe('cm');
    expect(parseCutList('Ad;En (mm);Boy (mm)\nA;39;71').unitAmbiguous).toBe(false);
  });

  it('values are never converted by the parser', () => {
    expect(values(parseCutList('Kapak;39,6;71,6').rows)[0]).toMatchObject({ w: 39.6, h: 71.6 });
  });
});

describe('cutListToParts', () => {
  it('builds importCutList parts from valid rows only, with caller ids', () => {
    const r = parseCutList(
      'Ad;En;Boy;Adet;Damar;Bant\nKapak;396;716;2;evet;0,8\nBozuk;x;1;1;;\nRaf;564;300;1;;',
    );
    expect(cutListToParts(r.rows, ['p1', 'p2'], 'mm')).toEqual([
      {
        id: 'p1',
        name: 'Kapak',
        qty: 2,
        grainLock: true,
        params: { w: 396, h: 716, r: 0 },
        edgeBand: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 },
      },
      {
        id: 'p2',
        name: 'Raf',
        qty: 1,
        grainLock: false,
        params: { w: 564, h: 300, r: 0 },
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    ]);
  });

  it('cm → mm only when the caller says so; edge band stays mm', () => {
    const r = parseCutList('Kapak;39,6;71,6;1;;');
    const [part] = cutListToParts(r.rows, ['a'], 'cm');
    expect(part?.params).toEqual({ w: 396, h: 716, r: 0 });
    expect(toMillimetres(0.1 * 3, 'cm')).toBe(3);
  });

  it('throws when too few ids are given', () => {
    const r = parseCutList('A;1;2\nB;3;4');
    expect(() => cutListToParts(r.rows, ['x'], 'mm')).toThrow(/2 ids needed/);
  });
});
