import { createHash } from 'node:crypto';
import { LABEL_PRESETS } from '@nittcam/core';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { labelPageCount, renderLabelsPdf } from './labels-pdf';
import { pdfTestProject } from './pdf.testing';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('label sheet PDF (T174)', () => {
  const project = pdfTestProject(); // 3 + 4 = 7 pieces
  const input = {
    project,
    projectName: 'Mutfak dolabı Şişli',
    revision: 2,
    grid: LABEL_PRESETS['a4-3x8'],
    offset: { x: 0, y: 0 },
  };

  it('is A4 portrait with enough pages for every piece', async () => {
    const doc = await PDFDocument.load(await renderLabelsPdf(input));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    const tiny = { ...LABEL_PRESETS['a4-3x8'], cols: 2, rows: 2 };
    expect(labelPageCount(project, tiny)).toBe(2);
    const doc2 = await PDFDocument.load(await renderLabelsPdf({ ...input, grid: tiny }));
    expect(doc2.getPageCount()).toBe(2);
  });

  it('is deterministic; the offset changes the bytes', async () => {
    const a = await renderLabelsPdf(input);
    expect(sha(await renderLabelsPdf(input))).toBe(sha(a));
    expect(sha(await renderLabelsPdf({ ...input, offset: { x: 1, y: 0 } }))).not.toBe(sha(a));
  });

  it('long names do not throw and the page stays one page', async () => {
    const long = pdfTestProject(['Çok uzun bir parça adı '.repeat(8), 'İ'.repeat(200)]);
    const doc = await PDFDocument.load(
      await renderLabelsPdf({ ...input, project: long, projectName: 'Ş'.repeat(300) }),
    );
    expect(doc.getPageCount()).toBe(1);
  });
});
