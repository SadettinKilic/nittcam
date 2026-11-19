import { cutListToCsv, parseCutList, type Part } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  cutListFileKind,
  decodeCsv,
  MAX_IMPORT_BYTES,
  readCutListFile,
  rowsToText,
} from './cut-list-file';

describe('cut-list files (T120)', () => {
  it('accepts .csv / .txt / .tsv / .xlsx by name, nothing else', () => {
    expect(cutListFileKind('liste.CSV')).toBe('csv');
    expect(cutListFileKind('liste.xlsx')).toBe('xlsx');
    expect(cutListFileKind('liste.xls')).toBeNull();
    expect(cutListFileKind('resim.png')).toBeNull();
    expect(cutListFileKind('liste')).toBeNull();
  });

  it('decodes UTF-8 with BOM and falls back to Windows-1254 for Turkish Excel CSV', () => {
    const utf8 = new TextEncoder().encode('\uFEFFAd;En\nÇekmece;400\n');
    expect(decodeCsv(utf8)).toBe('Ad;En\nÇekmece;400\n');
    // "Şİğ" in Windows-1254: Ş = 0xDE, İ = 0xDD, ğ = 0xF0.
    expect(decodeCsv(new Uint8Array([0xde, 0xdd, 0xf0]))).toBe('Şİğ');
  });

  it('spreadsheet rows: skips a title above the header, empty rows and empty columns', () => {
    const text = rowsToText([
      ['Mutfak kesim listesi', null, null, null, null],
      [null, null, null, null, null],
      ['Parça adı', 'En', 'Boy', 'Adet', null],
      ['Yan', 560, 720.5, 2, null],
      [null, null, null, null, null],
      ['Raf', 564, 300, 4, ''],
    ]);
    expect(text).toBe('Parça adı\tEn\tBoy\tAdet\nYan\t560\t720,5\t2\nRaf\t564\t300\t4');
    const parsed = parseCutList(text);
    expect(parsed.rows.map((r) => r.values.name)).toEqual(['Yan', 'Raf']);
    expect(parsed.rows.map((r) => r.values.h)).toEqual([720.5, 300]);
  });

  it('rejects wrong type, oversized and empty files before reading', async () => {
    const file = (name: string, body: BlobPart, size?: number) => {
      const f = new File([body], name);
      if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
      return f;
    };
    expect(await readCutListFile(file('a.pdf', 'x'))).toEqual({ ok: false, error: 'type' });
    expect(await readCutListFile(file('a.csv', 'x', MAX_IMPORT_BYTES + 1))).toEqual({
      ok: false,
      error: 'size',
    });
    expect(await readCutListFile(file('a.csv', ''))).toEqual({ ok: false, error: 'empty' });
    // A ZIP renamed to .csv is not shown as text.
    expect(await readCutListFile(file('a.csv', new Uint8Array([0x50, 0x4b, 3, 4, 0])))).toEqual({
      ok: false,
      error: 'type',
    });
    // A .xlsx that is not a ZIP.
    expect(await readCutListFile(file('a.xlsx', 'Ad;En'))).toEqual({ ok: false, error: 'type' });
  });

  it('the exported CSV re-imports through the file path', async () => {
    const part: Part = {
      id: 'a',
      name: 'Kapak',
      qty: 2,
      grain: { mode: 'fixed', angle: 90 },
      kind: 'rect',
      params: { w: 396.5, h: 716, r: 0 },
      inners: [],
      holes: [],
      edgeBand: { top: 0.8, right: 0, bottom: 0, left: 0 },
      templates: [],
    };
    const csv = cutListToCsv([part]).text;
    const read = await readCutListFile(new File([csv], 'kesim-listesi.csv'));
    if (!read.ok) throw new Error(read.error);
    const rows = parseCutList(read.text).rows;
    expect(rows[0]?.values).toMatchObject({ name: 'Kapak', w: 396.5, h: 716, qty: 2 });
  });
});
