/** T011 tester: adversarial workshop pastes for the cut-list parser. */
import { describe, expect, it } from 'vitest';
import { parseCutList, parseCutListNumber } from './index';

/** T011b: edgeBand is per edge now; a no-band row has 0 on all four edges. */
const allEdges = (n: number) => ({ top: n, right: n, bottom: n, left: n });
const vals = (text: string, opts = {}) => parseCutList(text, opts).rows.map((r) => r.values);

describe('workshop pastes', () => {
  it('Excel copy: tab header, Turkish decimals, CRLF, trailing empty line', () => {
    const text = 'Parça Adı\tEn\tBoy\tAdet\r\nKapak\t396,5\t716\t4\r\nRaf\t564\t300,25\t2\r\n\r\n';
    const r = parseCutList(text);
    expect(r.delimiter).toBe('\t');
    expect(r.hasHeader).toBe(true);
    expect(r.columns.fields).toEqual(['name', 'w', 'h', 'qty']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((x) => x.errors.length === 0)).toBe(true);
    expect(vals(text)).toEqual([
      {
        name: 'Kapak',
        w: 396.5,
        h: 716,
        qty: 4,
        grainLock: false,
        edgeBand: allEdges(0),
        grainAngle: null,
        note: '',
      },
      {
        name: 'Raf',
        w: 564,
        h: 300.25,
        qty: 2,
        grainLock: false,
        edgeBand: allEdges(0),
        grainAngle: null,
        note: '',
      },
    ]);
    expect(r.unitAmbiguous).toBe(false);
  });

  it('semicolon CSV with quoted names containing semicolons', () => {
    const text = 'Ad;En;Boy;Adet\n"Kapak; sol";396,5;716;2\n"Kapak; sağ";396,5;716;2\n';
    const r = parseCutList(text);
    expect(r.delimiter).toBe(';');
    expect(r.rows.map((x) => x.values.name)).toEqual(['Kapak; sol', 'Kapak; sağ']);
    expect(r.rows.every((x) => x.errors.length === 0)).toBe(true);
  });

  it('BOM at the start does not break the header', () => {
    const r = parseCutList('﻿Ad;En;Boy;Adet\nA;500;600;1\n');
    expect(r.hasHeader).toBe(true);
    expect(r.columns.fields).toEqual(['name', 'w', 'h', 'qty']);
    expect(r.rows[0]?.errors).toEqual([]);
  });

  it('empty qty cell means 1; missing qty column means 1', () => {
    expect(vals('Ad\tEn\tBoy\tAdet\nA\t500\t600\t\nB\t500\t600\t3').map((v) => v.qty)).toEqual([
      1, 3,
    ]);
    expect(vals('Ad\tEn\tBoy\nA\t500\t600').map((v) => v.qty)).toEqual([1]);
  });

  it('zero, negative sizes and text in number cells are row errors, not crashes', () => {
    const r = parseCutList(
      'Ad\tEn\tBoy\tAdet\nA\t0\t600\t1\nB\t-5\t600\t1\nC\tabc\t600\t1\nD\t500\t600\t0\nE\t500\t600\t1,5\nF\t500\t600\t1',
    );
    const codes = r.rows.map((x) => x.errors.map((e) => e.code));
    expect(codes[0]).toContain('NOT_POSITIVE');
    expect(codes[1]).toContain('NOT_POSITIVE');
    expect(codes[2]).toContain('INVALID_NUMBER');
    expect(codes[3]?.length).toBeGreaterThan(0);
    expect(codes[4]?.length).toBeGreaterThan(0);
    expect(codes[5]).toEqual([]);
  });

  it('"1.220" vs "1,220" vs "1220,0"', () => {
    expect(parseCutListNumber('1.220', 'comma')).toBe(1220);
    expect(parseCutListNumber('1220,0', 'comma')).toBe(1220);
    expect(parseCutListNumber('1,220', 'comma')).toBe(1.22);
    const r = parseCutList('Ad\tEn\tBoy\nA\t1.220\t2.440');
    expect(r.rows[0]?.values.w).toBe(1220);
    expect(r.warnings.map((w) => w.code)).toContain('THOUSANDS_ASSUMED');
    const d = parseCutList('Ad\tEn\tBoy\nA\t396.5\t716\nB\t1.220\t2.440');
    expect(d.rows[1]?.values.w).toBe(1.22);
    const c = parseCutList('Ad\tEn\tBoy\nA\t396,5\t716\nB\t1,220\t900');
    expect(c.rows[1]?.values.w).toBe(1.22);
    const z = parseCutList('Ad\tEn\tBoy\nA\t1220,0\t716');
    expect(z.rows[0]?.values.w).toBe(1220);
  });

  it('2000 rows parse in under 1 s', () => {
    const lines = ['Parça Adı\tEn\tBoy\tAdet'];
    for (let i = 0; i < 2000; i += 1) {
      lines.push(`Parça ${i}\t${300 + (i % 400)},5\t${500 + i}\t${1 + (i % 5)}`);
    }
    const text = lines.join('\r\n') + '\r\n';
    const t0 = Date.now();
    const r = parseCutList(text);
    const ms = Date.now() - t0;
    expect(r.rows).toHaveLength(2000);
    expect(r.rows.every((x) => x.errors.length === 0)).toBe(true);
    expect(ms).toBeLessThan(1000);
  });

  it('10 000 rows stay fast and are flagged TOO_MANY_ROWS', () => {
    const lines = ['Ad\tEn\tBoy'];
    for (let i = 0; i < 10000; i += 1) lines.push(`P${i}\t${300 + (i % 400)}\t${500 + i}`);
    const t0 = Date.now();
    const r = parseCutList(lines.join('\n'));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.warnings.map((w) => w.code)).toContain('TOO_MANY_ROWS');
  });

  it('cm-looking tables are unitAmbiguous and never converted', () => {
    const r = parseCutList('Ad\tEn\tBoy\tAdet\nKapak\t39,6\t71,6\t2\nRaf\t56,4\t30\t1');
    expect(r.unitAmbiguous).toBe(true);
    expect(r.rows[0]?.values.w).toBe(39.6);
    expect(r.rows[0]?.values.h).toBe(71.6);
    const n = parseCutList('Kapak\t39,6\t71,6\t2\nRaf\t56,4\t30\t1');
    expect(n.unitAmbiguous).toBe(true);
    expect(n.rows[0]?.values.w).toBe(39.6);
    expect(parseCutList('Ad\tEn (mm)\tBoy (mm)\nA\t39\t71').unitAmbiguous).toBe(false);
    const cm = parseCutList('Ad\tEn (cm)\tBoy (cm)\nA\t396\t716');
    expect(cm.unitAmbiguous).toBe(true);
    expect(cm.headerUnit).toBe('cm');
    expect(parseCutList('Ad\tEn\tBoy\nA\t396\t716').unitAmbiguous).toBe(false);
  });

  it('single column: clear error and warning, no crash', () => {
    const r = parseCutList('Kapak\nRaf\nSırt');
    expect(r.columnCount).toBe(1);
    expect(r.rows.every((x) => x.errors.length > 0)).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.errors.every((e) => e.message.length > 0))).toBe(true);
  });

  it.each([
    '',
    '   ',
    '\n\n',
    '﻿',
    '\t\t\n\t',
    '"',
    '"unterminated;1;2',
    ';;;\n;;;',
    'a,b\n"x"y",1',
  ])('degenerate input %j does not throw', (text) => {
    expect(() => parseCutList(text)).not.toThrow();
  });

  it('manual column mapping override works', () => {
    const r = parseCutList('A\t500\t600\nB\t300\t400', { columns: ['name', 'h', 'w'] });
    expect(r.rows[0]?.values).toMatchObject({ w: 600, h: 500 });
  });
});
