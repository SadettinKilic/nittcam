/**
 * PDF layout pages (T172, spec §6.6 "plaka dizilimi", §2.4): one landscape page per layout sheet
 * with the numbered parts, grain arrows, the sheet's dimensions and each part's cut size.
 */
import { fitSheet, PAPER_SIZES, type PaperSize, type SheetDrawing } from '@nittcam/core';
import { degrees, type PDFDocument, type PDFPage } from 'pdf-lib';
import { fill } from '../../draft-project';
import { getMessages } from '../../messages';
import {
  ACCENT,
  centred,
  fitText,
  grainArrow,
  INK,
  LINE,
  MUTED,
  PART_FILL,
  PART_STROKE,
  right,
  SHEET_FILL,
  text,
  WHITE,
  type PdfCompany,
  type PdfFonts,
} from './document';

const t = getMessages().pdf;

/** Page margin, points. */
export const PAGE_MARGIN = 28;
const HEADER = 44;
const FOOTER = 22;
/** Room for the sheet dimension lines (left and below the sheet), points. */
const DIM_ROOM = 18;

export interface PageHeader {
  projectName: string;
  revision: number;
  /** "MDF, 18 mm". */
  material: string;
  /** The company (T301): logo left of the project name, name first on the second line. */
  company?: PdfCompany | null;
}

/** Largest logo box in the page header, points. */
const LOGO_MAX_W = 84;
const LOGO_MAX_H = 30;

/** Draws the logo top-left in the header; returns the width it takes (0 without a logo). */
function drawLogo(page: PDFPage, company: PdfCompany | null | undefined, top: number): number {
  const logo = company?.logo;
  if (!logo) return 0;
  const scale = Math.min(LOGO_MAX_W / logo.width, LOGO_MAX_H / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  page.drawImage(logo, {
    x: PAGE_MARGIN,
    y: top - LOGO_MAX_H + (LOGO_MAX_H - h) / 2,
    width: w,
    height: h,
  });
  return w + 8;
}

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
export const mm = (v: number): string => nf.format(v);

/** Header and footer shared by every page of the document. */
export function drawFrame(
  page: PDFPage,
  fonts: PdfFonts,
  head: PageHeader,
  title: string,
  details: string,
  pageNo: number,
  pageCount: number,
  legend = '',
): void {
  const { width, height } = page.getSize();
  const top = height - PAGE_MARGIN;
  const shift = drawLogo(page, head.company, top);
  const left = PAGE_MARGIN + shift;
  text(
    page,
    fitText(head.projectName, fonts.bold, 14, width / 2 - shift),
    left,
    top - 12,
    fonts.bold,
    14,
  );
  const company = head.company?.name
    ? `${fitText(head.company.name, fonts.regular, 9, width / 4)} · `
    : '';
  text(
    page,
    fitText(
      `${company}${fill(t.revision, { revision: head.revision })} · ${head.material}`,
      fonts.regular,
      9,
      width / 2 - shift,
    ),
    left,
    top - 28,
    fonts.regular,
    9,
    MUTED,
  );
  right(page, title, width - PAGE_MARGIN, top - 12, fonts.bold, 12);
  right(page, details, width - PAGE_MARGIN, top - 28, fonts.regular, 9, MUTED);
  page.drawLine({
    start: { x: PAGE_MARGIN, y: top - HEADER + 8 },
    end: { x: width - PAGE_MARGIN, y: top - HEADER + 8 },
    thickness: 0.5,
    color: LINE,
  });
  const fy = PAGE_MARGIN - 4;
  text(page, legend, PAGE_MARGIN, fy, fonts.regular, 8, MUTED);
  right(
    page,
    `NittCAM · ${fill(t.page, { n: pageNo, total: pageCount })}`,
    width - PAGE_MARGIN,
    fy,
    fonts.regular,
    8,
    MUTED,
  );
}

/** Drawing area below the header and above the footer, points. */
export function contentBox(page: PDFPage): { x: number; y: number; width: number; height: number } {
  const { width, height } = page.getSize();
  return {
    x: PAGE_MARGIN,
    y: PAGE_MARGIN + FOOTER,
    width: width - 2 * PAGE_MARGIN,
    height: height - 2 * PAGE_MARGIN - HEADER - FOOTER,
  };
}

/** SVG path of a flat [x, y, …] ring in page points (Y down from the page top for drawSvgPath). */
function ringPath(
  ring: readonly number[],
  map: (x: number, y: number) => [number, number],
): string {
  let d = '';
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const [px, py] = map(ring[i] ?? 0, ring[i + 1] ?? 0);
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)} `;
  }
  return `${d}Z`;
}

function drawSheet(page: PDFPage, fonts: PdfFonts, sheet: SheetDrawing): void {
  const box = contentBox(page);
  const area = {
    x: box.x + DIM_ROOM,
    y: box.y + DIM_ROOM,
    width: box.width - DIM_ROOM,
    height: box.height - DIM_ROOM,
  };
  const fit = fitSheet(sheet, area);
  const s = fit.scale;
  const px = (x: number) => fit.x + x * s;
  const py = (y: number) => fit.y + y * s;
  const pageH = page.getSize().height;
  // drawSvgPath draws with Y down from (x, y); we give it page coordinates flipped about the top.
  const svg = (x: number, y: number): [number, number] => [px(x), pageH - py(y)];

  page.drawRectangle({
    x: px(0),
    y: py(0),
    width: sheet.width * s,
    height: sheet.height * s,
    color: SHEET_FILL,
    borderColor: INK,
    borderWidth: 0.8,
  });
  if (sheet.margin > 0 && sheet.margin * 2 < Math.min(sheet.width, sheet.height)) {
    page.drawRectangle({
      x: px(sheet.margin),
      y: py(sheet.margin),
      width: (sheet.width - 2 * sheet.margin) * s,
      height: (sheet.height - 2 * sheet.margin) * s,
      borderColor: LINE,
      borderWidth: 0.4,
      borderDashArray: [2, 2],
    });
  }

  // Sheet dimensions: width below, height on the left.
  const dimY = py(0) - 10;
  page.drawLine({
    start: { x: px(0), y: dimY + 3 },
    end: { x: px(sheet.width), y: dimY + 3 },
    thickness: 0.4,
    color: MUTED,
  });
  centred(page, `${mm(sheet.width)} mm`, px(sheet.width / 2), dimY - 6, fonts.regular, 8, MUTED);
  const dimX = px(0) - 10;
  page.drawLine({
    start: { x: dimX + 3, y: py(0) },
    end: { x: dimX + 3, y: py(sheet.height) },
    thickness: 0.4,
    color: MUTED,
  });
  const hLabel = `${mm(sheet.height)} mm`;
  page.drawText(hLabel, {
    x: dimX - 2,
    y: py(sheet.height / 2) - fonts.regular.widthOfTextAtSize(hLabel, 8) / 2,
    font: fonts.regular,
    size: 8,
    color: MUTED,
    rotate: degrees(90),
  });

  for (const part of sheet.parts) {
    page.drawSvgPath(ringPath(part.outline, svg), {
      x: 0,
      y: pageH,
      color: PART_FILL,
      borderColor: PART_STROKE,
      borderWidth: 0.6,
    });
    for (const inner of part.inners) {
      page.drawSvgPath(ringPath(inner, svg), {
        x: 0,
        y: pageH,
        color: SHEET_FILL,
        borderColor: PART_STROKE,
        borderWidth: 0.5,
      });
    }
    for (const hole of part.holes) {
      page.drawCircle({
        x: px(hole.x),
        y: py(hole.y),
        size: Math.max(0.6, hole.r * s),
        color: WHITE,
        borderColor: PART_STROKE,
        borderWidth: 0.4,
      });
    }
    const bw = part.box.w * s;
    const bh = part.box.h * s;
    const cx = px(part.box.x + part.box.w / 2);
    const cy = py(part.box.y + part.box.h / 2);
    if (part.grainAngle !== null) {
      const len = Math.max(8, Math.min(30, Math.min(bw, bh) * 0.45));
      // Bottom-left corner of the footprint, clear of the centred text.
      const r = len / 2 + 5;
      const ax = bw > 2 * r + 4 ? px(part.box.x) + r : cx;
      const ay = bh > 2 * r + 4 ? py(part.box.y) + r : cy;
      grainArrow(page, ax, ay, part.grainAngle, len, ACCENT);
    }
    const numSize = Math.max(
      4,
      Math.min(10, bh * 0.35, (bw - 4) / Math.max(1, fonts.bold.widthOfTextAtSize(part.number, 1))),
    );
    const lines: { value: string; size: number; bold: boolean }[] = [
      { value: part.number, size: numSize, bold: true },
    ];
    const small = Math.min(7, numSize * 0.8);
    if (bh > numSize + 2 * small + 8 && small >= 4) {
      lines.push({
        value: fitText(part.name, fonts.regular, small, bw - 6),
        size: small,
        bold: false,
      });
      lines.push({
        value: fitText(`${mm(part.width)} × ${mm(part.height)}`, fonts.regular, small, bw - 6),
        size: small,
        bold: false,
      });
    }
    const total = lines.reduce((sum, l) => sum + l.size + 1.5, 0);
    let y = cy + total / 2;
    for (const l of lines) {
      y -= l.size + 1.5;
      centred(
        page,
        l.value,
        cx,
        y + 1.5,
        l.bold ? fonts.bold : fonts.regular,
        l.size,
        l.bold ? INK : MUTED,
      );
    }
  }
}

/** Adds one page per layout sheet; returns the pages added. */
export function addLayoutPages(
  doc: PDFDocument,
  fonts: PdfFonts,
  head: PageHeader,
  sheets: readonly SheetDrawing[],
  paper: PaperSize,
  pageOffset: number,
  pageCount: number,
): PDFPage[] {
  const size = PAPER_SIZES[paper];
  return sheets.map((sheet, i) => {
    const page = doc.addPage([size.width, size.height]);
    const details = [
      fill(t.sheetSize, { w: mm(sheet.width), h: mm(sheet.height) }),
      sheet.grain === null ? t.noGrain : fill(t.grain, { angle: mm(sheet.grain) }),
      fill(t.parts, { count: sheet.parts.length }),
      ...(sheet.offcut ? [t.offcut] : []),
    ].join(' · ');
    drawFrame(
      page,
      fonts,
      head,
      fill(t.sheetTitle, { n: i + 1, total: sheets.length }),
      details,
      pageOffset + i + 1,
      pageCount,
      t.legend,
    );
    drawSheet(page, fonts, sheet);
    if (sheet.grain !== null) {
      // Sheet grain left of the title.
      const { width, height } = page.getSize();
      const title = fill(t.sheetTitle, { n: i + 1, total: sheets.length });
      const x = width - PAGE_MARGIN - fonts.bold.widthOfTextAtSize(title, 12) - 14;
      grainArrow(page, x, height - PAGE_MARGIN - 8, sheet.grain, 14, MUTED);
    }
    return page;
  });
}
