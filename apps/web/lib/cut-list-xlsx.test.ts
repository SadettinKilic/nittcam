import { readFileSync } from 'node:fs';
import { parseCutList } from '@nittcam/core';
import { expect, it } from 'vitest';
import { rowsToText } from './cut-list-file';

/** T120: a real .xlsx (merged title row, empty row, Turkish text) through the MIT reader. */
it('xlsx fixture → rows → cut-list text → parser', async () => {
  const { readSheet } = await import('read-excel-file/universal');
  const buf = readFileSync('../../e2e/tests/fixtures/kesim-listesi.xlsx');
  const rows = await readSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const text = rowsToText(rows as never);
  expect(text.split('\n')[0]).toBe('Parça adı\tEn\tBoy\tAdet\tDamar\tÜst bant');
  const parsed = parseCutList(text);
  expect(parsed.rows.flatMap((r) => r.errors)).toEqual([]);
  expect(parsed.rows.map((r) => r.values)).toMatchObject([
    { name: 'Çekmece önü', w: 596.5, h: 176, qty: 4, grainLock: true, edgeBand: { top: 0.8 } },
    { name: 'Yan dikme', w: 560, h: 720, qty: 2, grainLock: false, edgeBand: { top: 0 } },
  ]);
});
