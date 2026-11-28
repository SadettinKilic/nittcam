/**
 * Shared PDF plumbing (T172, spec §6.6, §8.3 "pdf-lib + gömülü font"): an embedded Turkish-capable
 * font (Inter, OFL-1.1, files and licence in `./fonts`) and fixed metadata so the same input always
 * gives the same bytes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

/**
 * Fixed metadata date of every generated PDF: the bytes must not depend on the clock (§6.6 "Aynı
 * girdi her zaman aynı dosyayı verir"). The export record keeps the real time.
 */
export const PDF_FIXED_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

const FONT_DIR_CANDIDATES = [
  join(process.cwd(), 'lib', 'server', 'pdf', 'fonts'),
  join(process.cwd(), 'apps', 'web', 'lib', 'server', 'pdf', 'fonts'),
];

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

function fontBytes(): { regular: Uint8Array; bold: Uint8Array } {
  if (fontCache) return fontCache;
  const dir = FONT_DIR_CANDIDATES.find((d) => existsSync(join(d, 'Inter-Regular.ttf')));
  if (!dir) throw new Error('PDF font files not found (lib/server/pdf/fonts)');
  fontCache = {
    regular: readFileSync(join(dir, 'Inter-Regular.ttf')),
    bold: readFileSync(join(dir, 'Inter-Bold.ttf')),
  };
  return fontCache;
}

export interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** A new document with the embedded fonts (subset, fixed names) and fixed metadata. */
export async function newDocument(
  title: string,
  subject: string,
): Promise<{ doc: PDFDocument; fonts: PdfFonts }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const bytes = fontBytes();
  // A fixed custom name: pdf-lib otherwise adds a random subset tag to the font name.
  const regular = await doc.embedFont(bytes.regular, { subset: true, customName: 'Inter-Regular' });
  const bold = await doc.embedFont(bytes.bold, { subset: true, customName: 'Inter-Bold' });
  doc.setTitle(title);
  doc.setSubject(subject);
  doc.setCreator('NittCAM');
  doc.setProducer('NittCAM');
  doc.setCreationDate(PDF_FIXED_DATE);
  doc.setModificationDate(PDF_FIXED_DATE);
  return { doc, fonts: { regular, bold } };
}

/**
 * The company on generated documents (T301, CTO #12 E2): its name and, when one is uploaded as
 * PNG or JPEG, its logo bytes. Both are part of the input: same name and logo, same bytes.
 */
export interface CompanyMark {
  name: string;
  logo: { type: 'png' | 'jpeg'; bytes: Uint8Array } | null;
}

/** A company mark embedded into one document. */
export interface PdfCompany {
  name: string;
  logo: PDFImage | null;
}

/** Embeds the company logo (a broken image is left out, the name stays); null without a company. */
export async function embedCompany(
  doc: PDFDocument,
  company: CompanyMark | null | undefined,
): Promise<PdfCompany | null> {
  if (!company) return null;
  let logo: PDFImage | null = null;
  if (company.logo) {
    try {
      logo =
        company.logo.type === 'png'
          ? await doc.embedPng(company.logo.bytes)
          : await doc.embedJpg(company.logo.bytes);
    } catch {
      logo = null;
    }
  }
  return { name: company.name.trim(), logo };
}

/** Saves with settings that keep the bytes stable. */
export async function saveDocument(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: false });
}

export const INK = rgb(0.13, 0.14, 0.16);
export const MUTED = rgb(0.42, 0.44, 0.48);
export const LINE = rgb(0.72, 0.74, 0.78);
export const SHEET_FILL = rgb(0.97, 0.96, 0.93);
export const PART_FILL = rgb(0.86, 0.9, 0.95);
export const PART_STROKE = rgb(0.2, 0.32, 0.5);
export const ACCENT = rgb(0.78, 0.36, 0.05);
export const WHITE = rgb(1, 1, 1);

/** Text cut to `maxWidth` with an ellipsis; '' when not even one letter fits. */
export function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const chars = [...text];
  const cut = (n: number) => `${chars.slice(0, n).join('').trimEnd()}…`;
  const fits = (n: number) => font.widthOfTextAtSize(cut(n), size) <= maxWidth;
  // Binary search for the longest prefix that fits (a linear scan was O(n²) on long names).
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? cut(lo) : '';
}

/** Draws text left-aligned at (x, y) baseline. */
export function text(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
): void {
  if (value) page.drawText(value, { x, y, font, size, color });
}

/** Draws text centred on x. */
export function centred(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
): void {
  if (!value) return;
  page.drawText(value, { x: x - font.widthOfTextAtSize(value, size) / 2, y, font, size, color });
}

/** Draws text right-aligned to x. */
export function right(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
): void {
  if (!value) return;
  page.drawText(value, { x: x - font.widthOfTextAtSize(value, size), y, font, size, color });
}

/**
 * A double-headed arrow (grain is an undirected line, D-034) of `length` points centred on (cx, cy)
 * at `angle` degrees CCW from +X. `directed` (T355, ACM film arrow): one head at the `angle` end.
 */
export function grainArrow(
  page: PDFPage,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  color = ACCENT,
  directed = false,
): void {
  const a = (angle * Math.PI) / 180;
  const dx = (Math.cos(a) * length) / 2;
  const dy = (Math.sin(a) * length) / 2;
  const start = { x: cx - dx, y: cy - dy };
  const end = { x: cx + dx, y: cy + dy };
  const thickness = Math.max(0.6, length / 30);
  page.drawLine({ start, end, thickness, color });
  const head = Math.min(5, length / 4);
  const tips = directed
    ? ([[end, a]] as const)
    : ([
        [end, a],
        [start, a + Math.PI],
      ] as const);
  for (const [tip, dir] of tips) {
    for (const side of [0.5, -0.5]) {
      page.drawLine({
        start: tip,
        end: {
          x: tip.x - Math.cos(dir + side) * head,
          y: tip.y - Math.sin(dir + side) * head,
        },
        thickness,
        color,
      });
    }
  }
}
