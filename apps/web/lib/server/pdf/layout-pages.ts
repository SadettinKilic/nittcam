/**
 * PDF layout pages (T172, spec §6.6 "plaka dizilimi", §2.4): one landscape page per layout sheet
 * with the numbered parts, grain arrows, the sheet's dimensions and each part's cut size.
 */
import {
  fitSheet,
  machineFrame,
  PAPER_SIZES,
  toMachineXY,
  type MachineProfile,
  type PaperSize,
  type SheetDrawing,
} from '@nittcam/core';
import { degrees, type PDFDocument, type PDFPage } from 'pdf-lib';
import { fill } from '../../fill';
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
/** T333: room for the NC file and tool-order lines above the sheet drawing, points. */
const NC_ROOM = 26;

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

/** What the sheet page needs of the machine to mark program zero (B51); null = not known. */
/** B51 (D-091): what the sheet page tells about a stock offcut, by offcut id. */
export interface PdfOffcut {
  width: number;
  height: number;
  /** "MDF 18". */
  material: string;
  /** Source project name; null = none (added by hand or the project is gone). */
  source: string | null;
  /** Short record number: the first 8 characters of the offcut id. */
  ref: string;
}

export type PdfMachine = Pick<MachineProfile, 'origin' | 'zZero' | 'workEnvelope'> | null;

/** T333 (N3): one tool run of a sheet program, in order of use. */
export interface PdfNcTool {
  number: number;
  diameter: number;
  /** Tool type of the profile ('' when unknown). */
  type: string;
}

/**
 * T333 (N3): the newest NC export of this revision as the sheet page names it: per layout sheet
 * index, the file names exactly as exported (split parts in order) and the tool runs in order of
 * use. null = no NC export of this revision yet.
 */
export interface PdfNc {
  sheets: Readonly<Record<number, { files: readonly string[]; tools: readonly PdfNcTool[] }>>;
  /** The machine's tool changer is manual: the operator changes the tool at each stop. */
  manual: boolean;
}

const toolNf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

/** "1. T1 Ø6 düz freze → 2. T2 Ø8 düz freze" (Ø to 0.01 mm: 6,35 is not 6,4). */
export function toolOrderText(tools: readonly PdfNcTool[]): string {
  const types = t.toolTypes as Record<string, string>;
  return tools
    .map((tool, i) =>
      fill(t.toolRun, {
        n: i + 1,
        tool: tool.number,
        d: toolNf.format(tool.diameter),
        type: types[tool.type] ?? '',
      }).trim(),
    )
    .join(' → ');
}

/**
 * T333 (N3): the two lines above the sheet drawing: the NC file(s) of the sheet and its tool order.
 * No export of this revision → one line saying so (never a guessed name).
 */
export function sheetNcLines(nc: PdfNc | null, sheetIndex: number): string[] {
  if (nc === null) return [t.ncNone];
  const sheet = nc.sheets[sheetIndex];
  if (!sheet || sheet.files.length === 0) return [t.ncNoFile];
  const files = fill(sheet.files.length > 1 ? t.ncFiles : t.ncFile, {
    names: sheet.files.join(' → '),
    count: sheet.files.length,
  });
  if (sheet.tools.length === 0) return [files];
  const order = toolOrderText(sheet.tools);
  const manual = nc.manual && sheet.tools.length > 1;
  return [files, fill(manual ? t.toolOrderManual : t.toolOrder, { order })];
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

function drawSheet(
  page: PDFPage,
  fonts: PdfFonts,
  sheet: SheetDrawing,
  machine: PdfMachine,
  ncLines: readonly string[],
): void {
  const box = contentBox(page);
  const top = box.y + box.height;
  ncLines.forEach((line, i) => {
    const font = i === 0 ? fonts.bold : fonts.regular;
    text(page, fitText(line, font, 9, box.width), box.x, top - 9 - i * 12, font, 9, INK);
  });
  const area = {
    x: box.x + DIM_ROOM,
    y: box.y + DIM_ROOM,
    width: box.width - DIM_ROOM,
    height: box.height - DIM_ROOM - NC_ROOM,
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
  if (machine) drawOrigin(page, fonts, sheet, machine, px, py, dimY - 6);

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
    // T325: blind contour pockets, dashed, with their depth when there is room.
    for (const pocket of part.pockets) {
      page.drawSvgPath(ringPath(pocket.ring, svg), {
        x: 0,
        y: pageH,
        borderColor: PART_STROKE,
        borderWidth: 0.5,
        borderDashArray: [2, 1.5],
      });
      const xs = pocket.ring.filter((_, i) => i % 2 === 0);
      const ys = pocket.ring.filter((_, i) => i % 2 === 1);
      const label = fill(t.pocketDepth, { d: mm(pocket.depth) });
      const w = (Math.max(...xs) - Math.min(...xs)) * s;
      const h = (Math.max(...ys) - Math.min(...ys)) * s;
      if (w > fonts.regular.widthOfTextAtSize(label, 6) + 4 && h > 9) {
        centred(
          page,
          label,
          px((Math.max(...xs) + Math.min(...xs)) / 2),
          py((Math.max(...ys) + Math.min(...ys)) / 2) - 2,
          fonts.regular,
          6,
          MUTED,
        );
      }
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
    // B51: the grain arrow sits in the bottom-left corner of the footprint. When the part is too
    // narrow or too low for that, the text keeps clear of it: narrower lines beside a left-edge
    // arrow, the text above a bottom-edge arrow, and no name/size lines when neither fits.
    let textW = bw - 6;
    let textCy = cy;
    let room = bh;
    let nameOk = true;
    if (part.grainAngle !== null) {
      const len = Math.max(8, Math.min(30, Math.min(bw, bh) * 0.45));
      const r = len / 2 + 5;
      const fitsX = bw > 2 * r + 4;
      const fitsY = bh > 2 * r + 4;
      const ax = fitsX ? px(part.box.x) + r : cx;
      const ay = fitsY ? py(part.box.y) + r : cy;
      grainArrow(page, ax, ay, part.grainAngle, len, ACCENT);
      if (fitsX && !fitsY) textW = bw - 4 * r - 6;
      else if (!fitsX && fitsY) {
        room = bh - 2 * r;
        textCy = cy + r;
      } else if (!fitsX && !fitsY) nameOk = false;
    }
    const numSize = Math.max(
      4,
      Math.min(
        10,
        room * 0.35,
        (Math.max(textW, 4) + 2) / Math.max(1, fonts.bold.widthOfTextAtSize(part.number, 1)),
      ),
    );
    const lines: { value: string; size: number; bold: boolean }[] = [
      { value: part.number, size: numSize, bold: true },
    ];
    const small = Math.min(7, numSize * 0.8);
    if (nameOk && textW > 12 && room > numSize + 2 * small + 8 && small >= 4) {
      lines.push({
        value: fitText(part.name, fonts.regular, small, textW),
        size: small,
        bold: false,
      });
      lines.push({
        value: fitText(`${mm(part.width)} × ${mm(part.height)}`, fonts.regular, small, textW),
        size: small,
        bold: false,
      });
    }
    const total = lines.reduce((sum, l) => sum + l.size + 1.5, 0);
    let y = textCy + total / 2;
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

/**
 * The sheet corner nearest program zero (sheet frame `cx`, `cy`) and its machine coordinates
 * (`x`, `y`; 0 when the sheet sits at zero). `left` = the corner is on the left (B51).
 */
export function originMark(
  sheet: Pick<SheetDrawing, 'width' | 'height'>,
  machine: NonNullable<PdfMachine>,
): { cx: number; cy: number; x: number; y: number; left: boolean } {
  const frame = machineFrame(machine, {
    thickness: 0,
    sheetWidth: sheet.width,
    sheetHeight: sheet.height,
  });
  const cx = frame.inX === 1 ? 0 : sheet.width;
  const cy = frame.inY === 1 ? 0 : sheet.height;
  const m = toMachineXY(frame, cx, cy);
  // + 0 turns -0 into 0
  return { cx, cy, x: m.x + 0, y: m.y + 0, left: frame.inX === 1 };
}

/**
 * B51 (D-091, CTO #11): marks the sheet corner at program zero with a dot and its machine
 * coordinates ("X0 Y0 · ön sol"), so the operator lays the sheet on the table from the paper.
 * The text sits below the sheet, on the corner's side.
 */
function drawOrigin(
  page: PDFPage,
  fonts: PdfFonts,
  sheet: SheetDrawing,
  machine: NonNullable<PdfMachine>,
  px: (x: number) => number,
  py: (y: number) => number,
  textY: number,
): void {
  const { cx, cy, x, y, left } = originMark(sheet, machine);
  page.drawCircle({ x: px(cx), y: py(cy), size: 2.6, color: ACCENT });
  const label = fill(t.origin, {
    x: mm(x),
    y: mm(y),
    corner: t.corners[machine.origin.corner],
  });
  if (left) text(page, label, px(0), textY, fonts.bold, 7, ACCENT);
  else right(page, label, px(sheet.width), textY, fonts.bold, 7, ACCENT);
}

/** "Artık parçadan: 1200 × 800 · MDF 18 · Mutfak · kayıt 1a2b3c4d"; plain when the row is unknown. */
export function offcutLine(o: PdfOffcut | undefined): string {
  if (!o) return t.offcut;
  return fill(t.offcutInfo, {
    w: mm(o.width),
    h: mm(o.height),
    material: o.material,
    source: o.source ?? t.offcutNoSource,
    ref: o.ref,
  });
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
  machine: PdfMachine = null,
  offcuts: Readonly<Record<string, PdfOffcut>> = {},
  nc: PdfNc | null = null,
): PDFPage[] {
  const size = PAPER_SIZES[paper];
  return sheets.map((sheet, i) => {
    const page = doc.addPage([size.width, size.height]);
    const details = [
      fill(t.sheetSize, { w: mm(sheet.width), h: mm(sheet.height) }),
      sheet.grain === null ? t.noGrain : fill(t.grain, { angle: mm(sheet.grain) }),
      fill(t.parts, { count: sheet.parts.length }),
      ...(sheet.offcut ? [offcutLine(sheet.offcutId ? offcuts[sheet.offcutId] : undefined)] : []),
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
    drawSheet(page, fonts, sheet, machine, sheetNcLines(nc, i));
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
