/**
 * PDF part list and waste report (T173, spec §6.6 "numaralı parça listesi, bantlı kenarlar, fire
 * raporu", §4.8 "PDF parça listesinde bantlı kenarlar işaretlenir").
 */
import { PAPER_SIZES, type PaperSize, type ProjectReport, type ReportPartRow } from '@nittcam/core';
import type { PDFDocument, PDFPage } from 'pdf-lib';
import { fill } from '../../fill';
import { formatPercentNumber, summaryTiles } from '../../report-summary';
import { getMessages } from '../../messages';
import { ACCENT, fitText, INK, LINE, MUTED, right, text, type PdfFonts } from './document';
import { contentBox, drawFrame, mm, type PageHeader } from './layout-pages';

export { formatArea, formatCutTime, formatPercent } from '../../report-summary';

const t = getMessages().pdf;

const ROW_H = 17;
const HEAD_H = 20;
const SUMMARY_H = 92;

/** "Üst 0,8 · Sağ 2" or "—". */
export function bandText(row: Pick<ReportPartRow, 'band' | 'bandedEdges'>): string {
  if (row.bandedEdges.length === 0) return t.bandNone;
  return row.bandedEdges
    .map((e) => fill(t.bandItem, { edge: t.bandEdges[e], mm: mm(row.band[e]) }))
    .join(' · ');
}

interface Column {
  key: 'no' | 'name' | 'finished' | 'cut' | 'qty' | 'grain' | 'band';
  title: string;
  width: number;
  align: 'left' | 'right';
}

function columns(width: number): Column[] {
  const fixed: Column[] = [
    { key: 'no', title: t.colNo, width: 34, align: 'left' },
    { key: 'name', title: t.colName, width: 0, align: 'left' },
    { key: 'finished', title: t.colFinished, width: 96, align: 'right' },
    { key: 'cut', title: t.colCut, width: 96, align: 'right' },
    { key: 'qty', title: t.colQty, width: 44, align: 'right' },
    { key: 'grain', title: t.colGrain, width: 64, align: 'right' },
    { key: 'band', title: t.colBand, width: 190, align: 'left' },
  ];
  const used = fixed.reduce((s, c) => s + c.width, 0);
  return fixed.map((c) => (c.key === 'name' ? { ...c, width: Math.max(80, width - used) } : c));
}

/** Rows that fit on the first (with the summary) and on every further page. */
function capacity(paper: PaperSize): { first: number; next: number } {
  const size = PAPER_SIZES[paper];
  // contentBox height without a page object: page height − 2·28 margin − 44 header − 22 footer.
  const h = size.height - 2 * 28 - 44 - 22;
  return {
    first: Math.max(1, Math.floor((h - SUMMARY_H - HEAD_H) / ROW_H)),
    next: Math.max(1, Math.floor((h - HEAD_H) / ROW_H)),
  };
}

/** Pages the part list and report take (at least one, for the summary). */
export function reportPageCount(report: ProjectReport, paper: PaperSize): number {
  const cap = capacity(paper);
  const rest = Math.max(0, report.parts.length - cap.first);
  return 1 + Math.ceil(rest / cap.next);
}

/** Small rectangle with the banded edges drawn thick (§4.8). */
function bandGlyph(page: PDFPage, x: number, y: number, row: ReportPartRow): void {
  const w = 18;
  const h = 11;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.6 });
  const edges: Record<string, [number, number, number, number]> = {
    top: [x, y + h, x + w, y + h],
    right: [x + w, y, x + w, y + h],
    bottom: [x, y, x + w, y],
    left: [x, y, x, y + h],
  };
  for (const e of row.bandedEdges) {
    const [x1, y1, x2, y2] = edges[e] ?? [0, 0, 0, 0];
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: 2.2,
      color: ACCENT,
    });
  }
}

function drawSummary(page: PDFPage, fonts: PdfFonts, report: ProjectReport, top: number): void {
  const box = contentBox(page);
  text(page, t.reportTitle, box.x, top - 12, fonts.bold, 11);
  // T177: the same tiles (labels, values, order) as the project page report card.
  const tiles = summaryTiles(report).map((tile): [string, string] => [tile.label, tile.value]);
  const tileW = box.width / tiles.length;
  tiles.forEach(([label, value], i) => {
    const x = box.x + i * tileW;
    page.drawRectangle({
      x: x + 2,
      y: top - 62,
      width: tileW - 4,
      height: 42,
      borderColor: LINE,
      borderWidth: 0.5,
    });
    text(
      page,
      fitText(label, fonts.regular, 8, tileW - 14),
      x + 8,
      top - 32,
      fonts.regular,
      8,
      MUTED,
    );
    text(page, fitText(value, fonts.bold, 14, tileW - 14), x + 8, top - 52, fonts.bold, 14);
  });
  const notes = report.bySize.map((s) =>
    fill(t.bySize, {
      w: mm(s.width),
      h: mm(s.height),
      sheets: s.sheets,
      waste: formatPercentNumber(s.wastePercent),
    }),
  );
  if (report.cutSeconds === null) notes.push(t.cutTimeHint);
  if (report.unplaced > 0) notes.push(fill(t.unplaced, { count: report.unplaced }));
  text(
    page,
    fitText(notes.join(' · '), fonts.regular, 8, box.width),
    box.x,
    top - 76,
    fonts.regular,
    8,
    report.unplaced > 0 ? ACCENT : MUTED,
  );
}

function cellText(row: ReportPartRow, key: Column['key']): string {
  switch (key) {
    case 'no':
      return String(row.row);
    case 'name':
      return row.group ? `${row.name} (${row.group})` : row.name;
    case 'finished':
      return `${mm(row.finished.w)} × ${mm(row.finished.h)}`;
    case 'cut':
      return `${mm(row.cut.w)} × ${mm(row.cut.h)}`;
    case 'qty':
      return String(row.qty);
    case 'grain':
      return row.grain === null ? t.grainFree : fill(t.grainFixed, { angle: mm(row.grain) });
    case 'band':
      return bandText(row);
  }
}

function drawTable(
  page: PDFPage,
  fonts: PdfFonts,
  rows: readonly ReportPartRow[],
  top: number,
): void {
  const box = contentBox(page);
  const cols = columns(box.width);
  let x = box.x;
  const headY = top - HEAD_H;
  page.drawRectangle({
    x: box.x,
    y: headY,
    width: box.width,
    height: HEAD_H,
    color: LINE,
    opacity: 0.35,
  });
  for (const c of cols) {
    const tx = c.align === 'right' ? x + c.width - 6 : x + 6;
    if (c.align === 'right') right(page, c.title, tx, headY + 6, fonts.bold, 8);
    else text(page, c.title, tx, headY + 6, fonts.bold, 8);
    x += c.width;
  }
  rows.forEach((row, i) => {
    const y = headY - (i + 1) * ROW_H;
    page.drawLine({
      start: { x: box.x, y },
      end: { x: box.x + box.width, y },
      thickness: 0.3,
      color: LINE,
    });
    let cx = box.x;
    for (const c of cols) {
      const baseline = y + 5;
      if (c.key === 'band') {
        bandGlyph(page, cx + 6, y + 3, row);
        const value = fitText(cellText(row, c.key), fonts.regular, 8, c.width - 36);
        text(page, value, cx + 30, baseline, fonts.regular, 8);
      } else if (c.key === 'name') {
        const extra =
          row.placed < row.qty ? fill(t.unplacedRow, { placed: row.placed, qty: row.qty }) : '';
        const extraW = extra ? fonts.regular.widthOfTextAtSize(extra, 7) + 8 : 0;
        const value = fitText(cellText(row, c.key), fonts.regular, 8, c.width - 12 - extraW);
        text(page, value, cx + 6, baseline, fonts.regular, 8);
        if (extra) right(page, extra, cx + c.width - 6, baseline, fonts.regular, 7, ACCENT);
      } else {
        const font = c.key === 'no' ? fonts.bold : fonts.regular;
        const value = fitText(cellText(row, c.key), font, 8, c.width - 12);
        if (c.align === 'right') right(page, value, cx + c.width - 6, baseline, font, 8, INK);
        else text(page, value, cx + 6, baseline, font, 8, INK);
      }
      cx += c.width;
    }
  });
}

/** Adds the part list and report pages; returns the pages added. */
export function addReportPages(
  doc: PDFDocument,
  fonts: PdfFonts,
  head: PageHeader,
  report: ProjectReport,
  paper: PaperSize,
  pageOffset: number,
  pageCount: number,
): PDFPage[] {
  const size = PAPER_SIZES[paper];
  const cap = capacity(paper);
  const chunks: ReportPartRow[][] = [report.parts.slice(0, cap.first)];
  for (let i = cap.first; i < report.parts.length; i += cap.next) {
    chunks.push(report.parts.slice(i, i + cap.next));
  }
  const details = fill(t.listDetails, { rows: report.parts.length, pieces: report.totalPieces });
  return chunks.map((rows, i) => {
    const page = doc.addPage([size.width, size.height]);
    const legend = report.dimensionMode === 'finished' ? t.listLegendFinished : t.listLegend;
    drawFrame(page, fonts, head, t.listTitle, details, pageOffset + i + 1, pageCount, legend);
    const box = contentBox(page);
    const top = box.y + box.height;
    if (i === 0) {
      drawSummary(page, fonts, report, top);
      drawTable(page, fonts, rows, top - SUMMARY_H);
    } else {
      drawTable(page, fonts, rows, top);
    }
    return page;
  });
}
