/**
 * Part label sheet PDF (T174, spec §2.4, §6.6): A4 portrait, one label per piece with project,
 * part number, name, size, grain arrow, edge-band glyph and sheet number. Generated on the server
 * from the saved revision; the grid and the print offset come from the request.
 */
import {
  labelCells,
  LABEL_PAGE,
  MM_TO_PT,
  partLabels,
  type LabelGrid,
  type LabelOffset,
  type PartLabel,
  type Project,
} from '@nittcam/core';
import type { PDFPage } from 'pdf-lib';
import { fill } from '../../fill';
import { getMessages } from '../../messages';
import {
  ACCENT,
  fitText,
  grainArrow,
  INK,
  LINE,
  MUTED,
  newDocument,
  right,
  saveDocument,
  text,
  type CompanyMark,
  type PdfFonts,
} from './document';
import { mm } from './layout-pages';

const t = getMessages().pdf.labels;

export interface LabelsPdfInput {
  project: Project;
  projectName: string;
  revision: number;
  grid: LabelGrid;
  offset: LabelOffset;
  /** Company name for the label foot (T301); the logo does not fit a label. */
  company?: CompanyMark | null;
}

/** Labels per page and page count of a label run. */
export function labelPageCount(project: Project, grid: LabelGrid): number {
  const perPage = grid.cols * grid.rows;
  const total = partLabels(project).length;
  return Math.max(1, Math.ceil(total / perPage));
}

/**
 * The part as a small rectangle in its own frame: banded edges thick, grain arrow inside (part
 * frame, as the piece lies when the label is read upright).
 */
function partGlyph(
  page: PDFPage,
  label: PartLabel,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.6 });
  const edges = {
    top: [x, y + h, x + w, y + h],
    right: [x + w, y, x + w, y + h],
    bottom: [x, y, x + w, y],
    left: [x, y, x, y + h],
  } as const;
  for (const e of label.bandedEdges) {
    const [x1, y1, x2, y2] = edges[e];
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: Math.max(1.4, w / 14),
      color: ACCENT,
    });
  }
  if (label.grain !== null) {
    grainArrow(page, x + w / 2, y + h / 2, label.grain, Math.min(w, h) * 0.75, INK);
  }
}

/**
 * "Project · Company" in `maxWidth`: the project keeps up to 60 % when both do not fit, the company
 * takes the rest (left out when not even a few letters fit).
 */
export function labelFoot(
  projectName: string,
  company: string,
  fonts: PdfFonts,
  size: number,
  maxWidth: number,
): string {
  const both = company ? `${projectName} · ${company}` : projectName;
  if (!company || fonts.regular.widthOfTextAtSize(both, size) <= maxWidth) {
    return fitText(both, fonts.regular, size, maxWidth);
  }
  const project = fitText(projectName, fonts.regular, size, maxWidth * 0.6);
  const rest = maxWidth - fonts.regular.widthOfTextAtSize(`${project} · `, size);
  const name = fitText(company, fonts.regular, size, rest);
  return name.length > 2 ? `${project} · ${name}` : project;
}

function drawLabel(
  page: PDFPage,
  fonts: PdfFonts,
  label: PartLabel,
  projectName: string,
  company: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Scale everything to the label (70 × 37 mm = 1), never larger than 1.6 or smaller than 0.45.
  const k = Math.max(0.45, Math.min(1.6, w / (70 * MM_TO_PT), h / (37 * MM_TO_PT)));
  const pad = 9 * k;
  const glyphW = 46 * k;
  const glyphH = Math.min(30 * k, h - 2 * pad - 14 * k);
  const textW = w - 2 * pad;
  const sideW = textW - glyphW - 6 * k;
  let line = y + h - pad;

  // Line 1: part number (bold, large) and the sheet number.
  const numSize = 14 * k;
  line -= numSize * 0.8;
  text(page, label.number, x + pad, line, fonts.bold, numSize);
  const sheet = label.sheet === null ? t.noSheet : fill(t.sheet, { n: label.sheet });
  right(page, sheet, x + w - pad, line, fonts.bold, 8.5 * k, label.sheet === null ? ACCENT : INK);

  // Line 2: name.
  const nameSize = 9 * k;
  line -= nameSize + 3 * k;
  text(page, fitText(label.name, fonts.bold, nameSize, textW), x + pad, line, fonts.bold, nameSize);

  // Lines 3–4 beside the glyph: finished size, cut size when it differs.
  const sizeSize = 8.5 * k;
  line -= sizeSize + 3 * k;
  const size = fill(t.size, { w: mm(label.finished.w), h: mm(label.finished.h) });
  text(page, fitText(size, fonts.regular, sizeSize, sideW), x + pad, line, fonts.regular, sizeSize);
  if (label.cut.w !== label.finished.w || label.cut.h !== label.finished.h) {
    line -= 7 * k + 2 * k;
    const cut = fill(t.cut, { w: mm(label.cut.w), h: mm(label.cut.h) });
    text(
      page,
      fitText(cut, fonts.regular, 7 * k, sideW),
      x + pad,
      line,
      fonts.regular,
      7 * k,
      MUTED,
    );
  }

  // Bottom line: project name, then the company (T301) when there is room.
  text(
    page,
    labelFoot(projectName, company, fonts, 7 * k, sideW),
    x + pad,
    y + pad,
    fonts.regular,
    7 * k,
    MUTED,
  );
  if (glyphH > 6) {
    // The part's own proportions inside the glyph box (very thin parts kept readable).
    const aspect = label.finished.w / label.finished.h;
    const gw = Math.max(8 * k, Math.min(glyphW, glyphH * aspect));
    const gh = Math.max(6 * k, Math.min(glyphH, gw / aspect));
    partGlyph(page, label, x + w - pad - gw, y + pad, gw, gh);
  }
}

export async function renderLabelsPdf(input: LabelsPdfInput): Promise<Uint8Array> {
  const { project, projectName, revision, grid, offset } = input;
  const { doc, fonts } = await newDocument(`${projectName}: ${t.title}`, `rev ${revision}`);
  const company = input.company?.name.trim() ?? '';
  const labels = partLabels(project);
  const cells = labelCells(grid, offset);
  const pw = LABEL_PAGE.width * MM_TO_PT;
  const ph = LABEL_PAGE.height * MM_TO_PT;
  const pages = Math.max(1, Math.ceil(labels.length / cells.length));
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([pw, ph]);
    labels.slice(p * cells.length, (p + 1) * cells.length).forEach((label, i) => {
      const c = cells[i];
      if (!c) return;
      // Cells are measured from the page's top-left corner; PDF points from the bottom-left.
      drawLabel(
        page,
        fonts,
        label,
        projectName,
        company,
        c.x * MM_TO_PT,
        ph - (c.y + c.height) * MM_TO_PT,
        c.width * MM_TO_PT,
        c.height * MM_TO_PT,
      );
    });
  }
  return saveDocument(doc);
}
