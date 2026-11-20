import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { asciiStem } from '../file-names';
import { PDF_FIXED_DATE } from './document';
import { pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('project PDF layout pages (T172)', () => {
  const project = pdfTestProject();
  const input = {
    project,
    projectName: 'Mutfak dolabı Şişli',
    revision: 3,
    paper: 'A4' as const,
    cutSeconds: 754,
  };

  it('has one landscape page per layout sheet, then the part list page', async () => {
    expect(project.layout.sheets.length).toBeGreaterThan(1);
    const doc = await PDFDocument.load(await renderProjectPdf(input));
    expect(doc.getPageCount()).toBe(project.layout.sheets.length + 1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });

  it('A3 pages are larger than A4', async () => {
    const doc = await PDFDocument.load(await renderProjectPdf({ ...input, paper: 'A3' }));
    expect(Math.round(doc.getPage(0).getWidth())).toBe(1191);
  });

  it('gives the same bytes for the same input', async () => {
    const a = await renderProjectPdf(input);
    const b = await renderProjectPdf(input);
    expect(sha(a)).toBe(sha(b));
    const other = await renderProjectPdf({ ...input, revision: 4 });
    expect(sha(other)).not.toBe(sha(a));
  });

  it('embeds the Inter font with fixed names and fixed metadata dates', async () => {
    const bytes = await renderProjectPdf(input);
    const raw = Buffer.from(bytes).toString('latin1');
    expect(raw).toContain('/BaseFont /Inter-Bold');
    expect(raw).toContain('/BaseFont /Inter-Regular');
    expect(raw).toContain('/FontFile2');
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getCreationDate()?.getTime()).toBe(PDF_FIXED_DATE.getTime());
    expect(doc.getModificationDate()?.getTime()).toBe(PDF_FIXED_DATE.getTime());
    expect(doc.getTitle()).toBe('Mutfak dolabı Şişli');
  });

  it('renders Turkish letters (ğüşıöç İ) without falling back', async () => {
    const turkish = pdfTestProject(['ĞÜŞİÖÇ ğüşıöç', 'Iİıi']);
    const bytes = await renderProjectPdf({ ...input, project: turkish, projectName: 'Çğıİöşü' });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('still makes one layout page (plus the list) for a project without a layout', async () => {
    const empty = { ...project, layout: { sheets: [] } };
    const doc = await PDFDocument.load(await renderProjectPdf({ ...input, project: empty }));
    expect(doc.getPageCount()).toBe(2);
  });
});

describe('asciiStem', () => {
  it('transliterates Turkish and drops the rest', () => {
    expect(asciiStem('Mutfak dolabı Şişli / 2', 'x')).toBe('Mutfak-dolabi-Sisli-2');
    expect(asciiStem('✓✓', 'proje')).toBe('proje');
  });
});

describe('embedded font coverage', () => {
  it('has a glyph for every Turkish letter (no .notdef)', async () => {
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const file of ['Inter-Regular.ttf', 'Inter-Bold.ttf']) {
      const font = fontkit.create(readFileSync(join(__dirname, 'fonts', file)));
      const run = font.layout('ğüşıöçĞÜŞİÖÇ×…·');
      expect(run.glyphs.every((g) => g.id !== 0)).toBe(true);
    }
  });
});
