import { PDFPage } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetNcLines, toolOrderText, type PdfNc } from './layout-pages';
import { pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';

const T1 = { number: 1, diameter: 6, type: 'flatEndMill' };
const T2 = { number: 2, diameter: 8, type: 'flatEndMill' };

/** Every string drawn on the PDF pages, page by page (the text content of the document). */
async function pageTexts(nc: PdfNc | null | undefined): Promise<string[][]> {
  const pages = new Map<PDFPage, string[]>();
  const spy = vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
    this: PDFPage,
    value: string,
  ) {
    pages.set(this, [...(pages.get(this) ?? []), value]);
  });
  await renderProjectPdf({
    project: pdfTestProject(),
    projectName: 'Mutfak',
    revision: 3,
    paper: 'A4',
    cutSeconds: null,
    ...(nc !== undefined ? { nc } : {}),
  });
  spy.mockRestore();
  return [...pages.values()];
}

afterEach(() => vi.restoreAllMocks());

describe('PDF sheet page: NC file and tool order (T333, N3)', () => {
  it('formats the tool order with the tool type', () => {
    expect(toolOrderText([T1, T2])).toBe('1. T1 Ø6 düz freze → 2. T2 Ø8 düz freze');
    expect(toolOrderText([{ number: 4, diameter: 6.35, type: '' }])).toBe('1. T4 Ø6,35');
  });

  it('names the file and the tool order; "elle değişim" only with a manual change', () => {
    const nc: PdfNc = {
      sheets: { 0: { files: ['Mutfak_r3_S1.tap'], tools: [T1, T2] } },
      manual: true,
    };
    expect(sheetNcLines(nc, 0)).toEqual([
      'NC dosyası: Mutfak_r3_S1.tap',
      'Takım sırası: 1. T1 Ø6 düz freze → 2. T2 Ø8 düz freze · elle değişim',
    ]);
    expect(sheetNcLines({ ...nc, manual: false }, 0)[1]).toBe(
      'Takım sırası: 1. T1 Ø6 düz freze → 2. T2 Ø8 düz freze',
    );
    // one tool: nothing to change by hand
    const one: PdfNc = { sheets: { 0: { files: ['M_S1.tap'], tools: [T2] } }, manual: true };
    expect(sheetNcLines(one, 0)[1]).toBe('Takım sırası: 1. T2 Ø8 düz freze');
  });

  it('lists every part of a split sheet in order', () => {
    const nc: PdfNc = {
      sheets: { 1: { files: ['M_S2_P1.tap', 'M_S2_P2.tap'], tools: [T1] } },
      manual: false,
    };
    expect(sheetNcLines(nc, 1)[0]).toBe('NC dosyaları (2, bu sırayla): M_S2_P1.tap → M_S2_P2.tap');
    expect(sheetNcLines(nc, 0)).toEqual(['NC dosyası: bu plakada kesilecek iş yok.']);
  });

  it('says so when the revision has no NC export (never a guessed name)', () => {
    const [line] = sheetNcLines(null, 0);
    expect(line).toContain('henüz dışa aktarılmadı');
    expect(line).not.toMatch(/\.tap/);
  });

  it('every sheet page carries its own lines; the other pages do not', async () => {
    const project = pdfTestProject();
    const n = project.layout.sheets.length;
    expect(n).toBeGreaterThan(1);
    const sheets: Record<number, { files: string[]; tools: (typeof T1)[] }> = {};
    for (let i = 0; i < n; i++) sheets[i] = { files: [`Mutfak_r3_S${i + 1}.tap`], tools: [T1, T2] };
    const pages = await pageTexts({ sheets, manual: true });
    for (let i = 0; i < n; i++) {
      expect(pages[i]).toContain(`NC dosyası: Mutfak_r3_S${i + 1}.tap`);
      expect(pages[i]).toContain(
        'Takım sırası: 1. T1 Ø6 düz freze → 2. T2 Ø8 düz freze · elle değişim',
      );
    }
    for (const page of pages.slice(n)) expect(page.join('\n')).not.toContain('NC dosya');
  });

  it('without an export every sheet page says none', async () => {
    const pages = await pageTexts(undefined);
    expect(pages[0]?.some((s) => s.includes('henüz dışa aktarılmadı'))).toBe(true);
    expect(pages.flat().some((s) => s.includes('.tap'))).toBe(false);
  });
});
