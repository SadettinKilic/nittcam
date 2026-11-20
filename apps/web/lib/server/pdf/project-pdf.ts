/**
 * The project PDF (spec §6.6): layout pages (T172), then the part list and waste report (T173). Generated on the server from the saved
 * revision; the same project, revision and paper always give the same bytes.
 */
import {
  layoutDrawing,
  materialKindOf,
  projectReport,
  type PaperSize,
  type Project,
} from '@nittcam/core';
import { PAPER_SIZES } from '@nittcam/core';
import { fill } from '../../fill';
import { getMessages } from '../../messages';
import { centred, MUTED, newDocument, saveDocument } from './document';
import { addReportPages, reportPageCount } from './report-pages';
import {
  addLayoutPages,
  contentBox,
  drawFrame,
  mm,
  type PageHeader,
  type PdfMachine,
} from './layout-pages';

const messages = getMessages();
const t = messages.pdf;

export interface ProjectPdfInput {
  project: Project;
  projectName: string;
  revision: number;
  paper: PaperSize;
  /** Estimated machining time, s (T173); null = not available. */
  cutSeconds: number | null;
  /** The pinned machine profile, for the program-zero mark (B51); null/absent = no mark. */
  machine?: PdfMachine | undefined;
}

/** Turkish material label and thickness for the page header. */
export function materialLabel(project: Project): string {
  const kind = materialKindOf(project.stock.material);
  const names = messages.materials as Record<string, string>;
  const name =
    kind !== null && names[kind]
      ? names[kind]
      : fill(names['unknown'] ?? '{id}', { id: project.stock.material });
  return fill(t.material, { material: name, thickness: mm(project.stock.thickness) });
}

export async function renderProjectPdf(input: ProjectPdfInput): Promise<Uint8Array> {
  const { project, projectName, revision, paper, cutSeconds } = input;
  const head: PageHeader = { projectName, revision, material: materialLabel(project) };
  const { doc, fonts } = await newDocument(projectName, fill(t.revision, { revision }));
  const sheets = layoutDrawing(project);
  const report = projectReport(project, cutSeconds);
  const layoutPages = Math.max(1, sheets.length);
  const pageCount = layoutPages + reportPageCount(report, paper);
  if (sheets.length === 0) {
    const size = PAPER_SIZES[paper];
    const page = doc.addPage([size.width, size.height]);
    drawFrame(page, fonts, head, '', '', 1, pageCount);
    const box = contentBox(page);
    centred(page, t.empty, box.x + box.width / 2, box.y + box.height / 2, fonts.regular, 11, MUTED);
  } else {
    addLayoutPages(doc, fonts, head, sheets, paper, 0, pageCount, input.machine ?? null);
  }
  addReportPages(doc, fonts, head, report, paper, layoutPages, pageCount);
  return saveDocument(doc);
}
