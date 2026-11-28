/**
 * "Montaj föyü" page of the project PDF (T389, optional: `project.assembly.sheet`): the exploded
 * isometric view of the montaj tezgâhı with numbered balloons, and the numbered part list.
 * Display only; byte-stable like the rest of the PDF.
 */
import { PAPER_SIZES, type PaperSize } from '@nittcam/core';
import { rgb, type PDFDocument } from 'pdf-lib';
import { fill } from '../../fill';
import { getMessages } from '../../messages';
import type { AssemblySheet } from '../../preview3d/assembly-sheet';
import {
  centred,
  fitText,
  LINE,
  MUTED,
  PART_STROKE,
  right,
  text,
  WHITE,
  type PdfFonts,
} from './document';
import { contentBox, drawFrame, mm, type PageHeader } from './layout-pages';

const messages = getMessages();
const t = messages.pdf.assembly;

const ROW_H = 15;
const HEAD_H = 18;
/** The drawing keeps at least this share of the content height. */
const MIN_DRAWING = 0.55;
const CAP_FILL = rgb(0.95, 0.96, 0.98);
const SIDE_FILL = rgb(0.84, 0.87, 0.92);
const BALLOON_R = 7;

/** Adds the page (call after the other pages; `pageNo` is 1-based). */
export function addAssemblyPage(
  doc: PDFDocument,
  fonts: PdfFonts,
  head: PageHeader,
  sheet: AssemblySheet,
  paper: PaperSize,
  pageNo: number,
  pageCount: number,
): void {
  const size = PAPER_SIZES[paper];
  // Landscape like the layout pages: wide drawing, list underneath.
  const page = doc.addPage([size.width, size.height]);
  const copies = sheet.rows.reduce((s, r) => s + r.qty, 0);
  drawFrame(page, fonts, head, t.title, fill(t.details, { count: copies }), pageNo, pageCount);
  const box = contentBox(page);

  // ---- part list (bottom), as many rows as fit; the rest summed up. T390: the bağlantı
  // elemanları follow the parts (no balloon number), and a material column when the
  // assembly mixes materials. ----
  type Row = { no: string; name: string; size: string; material: string; qty: number };
  const mixed = new Set(sheet.rows.map((r) => r.material)).size > 1;
  const all: Row[] = [
    ...sheet.rows.map((r) => ({
      no: String(r.no),
      name: r.name,
      size: `${mm(r.size[0])} × ${mm(r.size[1])} × ${mm(r.size[2])}`,
      material: messages.materials[r.material],
      qty: r.qty,
    })),
    ...sheet.fasteners.map((f) => ({
      no: '',
      name: fill(t.fastener, {
        name: fill(t.fastenerKinds[f.kind], { d: mm(f.d), length: mm(f.length) }),
      }),
      size: '',
      material: '',
      qty: f.qty,
    })),
  ];
  const maxRows = Math.max(1, Math.floor((box.height * (1 - MIN_DRAWING) - HEAD_H) / ROW_H));
  const shown = all.length > maxRows ? all.slice(0, maxRows - 1) : all;
  const more = all.length - shown.length;
  const tableH = HEAD_H + (shown.length + (more > 0 ? 1 : 0)) * ROW_H;
  const matW = mixed ? 120 : 0;
  const cols = [
    { title: t.no, w: 40, align: 'right' as const },
    { title: t.name, w: box.width - 40 - 160 - 60 - matW, align: 'left' as const },
    ...(mixed ? [{ title: t.material, w: matW, align: 'left' as const }] : []),
    { title: t.size, w: 160, align: 'right' as const },
    { title: t.qty, w: 60, align: 'right' as const },
  ];
  const tableTop = box.y + tableH;
  page.drawRectangle({
    x: box.x,
    y: tableTop - HEAD_H,
    width: box.width,
    height: HEAD_H,
    color: LINE,
    opacity: 0.35,
  });
  let cx = box.x;
  for (const c of cols) {
    if (c.align === 'right')
      right(page, c.title, cx + c.w - 6, tableTop - HEAD_H + 5, fonts.bold, 8);
    else text(page, c.title, cx + 6, tableTop - HEAD_H + 5, fonts.bold, 8);
    cx += c.w;
  }
  shown.forEach((r, i) => {
    const y = tableTop - HEAD_H - (i + 1) * ROW_H;
    page.drawLine({
      start: { x: box.x, y },
      end: { x: box.x + box.width, y },
      thickness: 0.3,
      color: LINE,
    });
    const cells = [r.no, r.name, ...(mixed ? [r.material] : []), r.size, String(r.qty)];
    let x = box.x;
    cols.forEach((c, k) => {
      const value = fitText(cells[k] ?? '', fonts.regular, 8, c.w - 12);
      if (c.align === 'right') right(page, value, x + c.w - 6, y + 4, fonts.regular, 8);
      else text(page, value, x + 6, y + 4, fonts.regular, 8);
      x += c.w;
    });
  });
  if (more > 0) {
    const y = tableTop - HEAD_H - (shown.length + 1) * ROW_H;
    text(page, fill(t.more, { count: more }), box.x + 46, y + 4, fonts.regular, 8, MUTED);
  }

  // ---- exploded drawing (top) ----
  const area = {
    x: box.x,
    y: tableTop + 12,
    width: box.width,
    height: box.y + box.height - tableTop - 24,
  };
  const bw = Math.max(1, sheet.bounds.maxX - sheet.bounds.minX);
  const bh = Math.max(1, sheet.bounds.maxY - sheet.bounds.minY);
  const pad = BALLOON_R * 2;
  const s = Math.min((area.width - 2 * pad) / bw, (area.height - 2 * pad) / bh);
  const ox = area.x + (area.width - bw * s) / 2 - sheet.bounds.minX * s;
  const oy = area.y + (area.height - bh * s) / 2 - sheet.bounds.minY * s;
  const pageH = page.getSize().height;
  for (const f of sheet.faces) {
    let d = '';
    f.pts.forEach(([x, y], i) => {
      d += `${i === 0 ? 'M' : 'L'}${(ox + x * s).toFixed(2)} ${(pageH - (oy + y * s)).toFixed(2)} `;
    });
    page.drawSvgPath(`${d}Z`, {
      x: 0,
      y: pageH,
      color: f.cap ? CAP_FILL : SIDE_FILL,
      borderColor: PART_STROKE,
      borderWidth: 0.4,
    });
  }
  for (const b of sheet.balloons) {
    const x = ox + b.x * s;
    const y = oy + b.y * s;
    page.drawCircle({
      x,
      y,
      size: BALLOON_R,
      color: WHITE,
      borderColor: PART_STROKE,
      borderWidth: 0.8,
    });
    centred(page, String(b.no), x, y - 2.8, fonts.bold, 7.5, PART_STROKE);
  }
  text(page, t.note, area.x, area.y + area.height + 2, fonts.regular, 7, MUTED);
}
