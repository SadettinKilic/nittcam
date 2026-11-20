import { createHash } from 'node:crypto';
import { LABEL_PRESETS } from '@nittcam/core';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { companyMark } from '../company-mark';
import type { CompanyMark } from './document';
import { labelFoot, renderLabelsPdf } from './labels-pdf';
import { pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
// 1 × 1 px images: a PNG and a (progressive) JPEG.
const PNG = b64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);
const JPEG = b64(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

const storageOf = (files: Record<string, Uint8Array>) => ({
  get: async (key: string) => files[key] ?? null,
});

describe('company mark on documents (T301)', () => {
  const project = pdfTestProject();
  const base = {
    project,
    projectName: 'Mutfak',
    revision: 2,
    paper: 'A4' as const,
    cutSeconds: 60,
  };
  const named: CompanyMark = { name: 'Şahin Ağaç İşleri', logo: null };
  const withLogo: CompanyMark = { name: 'Şahin Ağaç İşleri', logo: { type: 'png', bytes: PNG } };

  it('reads PNG and JPEG logos; a WebP or missing logo keeps only the name', async () => {
    const files = { 'a.png': PNG, 'b.jpg': JPEG, 'c.webp': WEBP };
    const m = (logoKey: string | null) => companyMark({ name: 'X', logoKey }, storageOf(files));
    expect((await m('a.png'))?.logo?.type).toBe('png');
    expect((await m('b.jpg'))?.logo?.type).toBe('jpeg');
    expect(await m('c.webp')).toEqual({ name: 'X', logo: null });
    expect(await m('gone.png')).toEqual({ name: 'X', logo: null });
    expect(await m(null)).toEqual({ name: 'X', logo: null });
    expect(await companyMark(null, storageOf(files))).toBeNull();
  });

  it('project PDF: same name and logo give the same bytes; name and logo change them', async () => {
    const a = await renderProjectPdf({ ...base, company: withLogo });
    expect(sha(await renderProjectPdf({ ...base, company: withLogo }))).toBe(sha(a));
    const noLogo = await renderProjectPdf({ ...base, company: named });
    const other = await renderProjectPdf({ ...base, company: { ...named, name: 'Başka' } });
    const none = await renderProjectPdf(base);
    expect(new Set([a, noLogo, other, none].map(sha)).size).toBe(4);
    const raw = Buffer.from(a).toString('latin1');
    expect(raw).toContain('/Subtype /Image');
    expect(Buffer.from(noLogo).toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('embeds a JPEG logo and survives a broken logo file (name only)', async () => {
    const jpeg = await renderProjectPdf({
      ...base,
      company: { ...named, logo: { type: 'jpeg', bytes: JPEG } },
    });
    expect(Buffer.from(jpeg).toString('latin1')).toContain('/DCTDecode');
    const broken = await renderProjectPdf({
      ...base,
      company: { ...named, logo: { type: 'png', bytes: PNG.slice(0, 20) } },
    });
    expect(sha(broken)).toBe(sha(await renderProjectPdf({ ...base, company: named })));
  });

  it('a 120-letter Turkish name still renders every page', async () => {
    const long = { name: 'Ğ'.repeat(120), logo: { type: 'png' as const, bytes: PNG } };
    const doc = await PDFDocument.load(await renderProjectPdf({ ...base, company: long }));
    expect(doc.getPageCount()).toBe(project.layout.sheets.length + 1);
  });

  it('labels carry the company name; same input → same bytes', async () => {
    const input = {
      project,
      projectName: 'Mutfak',
      revision: 2,
      grid: LABEL_PRESETS['a4-3x8'],
      offset: { x: 0, y: 0 },
    };
    const a = await renderLabelsPdf({ ...input, company: named });
    expect(sha(await renderLabelsPdf({ ...input, company: named }))).toBe(sha(a));
    expect(sha(await renderLabelsPdf(input))).not.toBe(sha(a));
  });
});

describe('labelFoot (T301)', () => {
  // A fixed-width stand-in font: every letter is 5 pt wide at any size.
  const font = { widthOfTextAtSize: (s: string) => [...s].length * 5 };
  const fonts = { regular: font, bold: font } as never;

  it('shows project and company when both fit', () => {
    expect(labelFoot('Mutfak', 'Şahin', fonts, 7, 200)).toBe('Mutfak · Şahin');
  });
  it('keeps the project only without a company', () => {
    expect(labelFoot('Mutfak', '', fonts, 7, 200)).toBe('Mutfak');
  });
  it('shares the width when both do not fit: project first, company shortened', () => {
    const foot = labelFoot('P'.repeat(30), 'C'.repeat(30), fonts, 7, 200);
    expect(foot.startsWith('PPPPP')).toBe(true);
    expect(foot).toContain(' · C');
    expect([...foot].length * 5).toBeLessThanOrEqual(200);
  });
  it('drops the company when not even a few letters fit', () => {
    expect(labelFoot('P'.repeat(60), 'C'.repeat(30), fonts, 7, 60)).not.toContain('·');
  });
});
