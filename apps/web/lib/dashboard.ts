/**
 * Ana sayfa (spec §3.4, T106): pure helpers that turn the company's projects, machines and exports
 * into the dashboard's numbers, the machine list order and the layout thumbnails.
 */
import { footprintOutline } from './placed-outline';
import {
  partShape,
  rotatedBoxSize,
  summarizeLayout,
  type Project,
  type VerificationState,
  defaultSheet,
  toCutSizes,
} from '@nittcam/core';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DashboardStats {
  projects: number;
  drafts: number;
  /** NC exports in the last 7 days (rolling window ending at `now`). */
  exportsThisWeek: number;
  machines: number;
  verified: number;
  /** Machines that are not verified (draft, partly verified or re-verification needed). */
  pending: number;
}

export function dashboardStats(input: {
  projects: readonly { status: string }[];
  machines: readonly { state: VerificationState }[];
  exports: readonly { createdAt: string | Date }[];
  now: Date;
}): DashboardStats {
  const since = input.now.getTime() - 7 * DAY_MS;
  const exportsThisWeek = input.exports.filter((e) => {
    const t = new Date(e.createdAt).getTime();
    return t > since && t <= input.now.getTime();
  }).length;
  const verified = input.machines.filter((m) => m.state === 'verified').length;
  return {
    projects: input.projects.length,
    drafts: input.projects.filter((p) => p.status === 'draft').length,
    exportsThisWeek,
    machines: input.machines.length,
    verified,
    pending: input.machines.length - verified,
  };
}

/** How urgent a verification state is on the home page: re-verify first, verified last. */
const URGENCY: Record<VerificationState, number> = {
  reverify_needed: 0,
  draft: 1,
  air_cut_approved: 2,
  test_cut_approved: 3,
  verified: 4,
};

/** Machines needing attention first; ties keep the name order (Turkish collation). */
export function machinesByUrgency<T extends { state: VerificationState; name: string }>(
  machines: readonly T[],
): T[] {
  return [...machines].sort(
    (a, b) => URGENCY[a.state] - URGENCY[b.state] || a.name.localeCompare(b.name, 'tr'),
  );
}

/** A small drawing of the first sheet: sheet size and part footprints in sheet mm (y up). */
export interface LayoutThumb {
  sheet: { width: number; height: number };
  /** Stock material id (`project.stock.material`), for the sheet tint (T180). */
  material: string;
  sheets: number;
  /** `outline`: the true outline of a turned or drawn part (footprint frame, Y down; T116). */
  parts: { x: number; y: number; w: number; h: number; outline: number[] | null }[];
  /** Material use of the whole layout in percent (placed part area / used sheet area). */
  utilisation: number;
}

/** At most this many parts are drawn in a thumbnail (it is a hint, not a preview). */
export const THUMB_MAX_PARTS = 200;

/**
 * The thumbnail of a project's first sheet, or null when the project has no layout yet. Placements
 * of unknown parts are skipped; at most `THUMB_MAX_PARTS` parts are kept.
 */
export function layoutThumb(entered: Project): LayoutThumb | null {
  // T169: parts are drawn at their cut size (edge-band deduction).
  const project = toCutSizes(entered);
  const first = project.layout.sheets[0];
  if (!first || first.placements.length === 0) return null;
  const parts = new Map(project.parts.map((p) => [p.id, p]));
  const out: LayoutThumb['parts'] = [];
  for (const pl of first.placements) {
    if (out.length >= THUMB_MAX_PARTS) break;
    const part = parts.get(pl.partId);
    if (!part) continue;
    // Footprint = bbox of the rotated outline (quarter turns swap w × h exactly, D-034).
    const size = rotatedBoxSize(partShape(part), pl.rot);
    out.push({
      x: pl.x,
      y: pl.y,
      w: size.w,
      h: size.h,
      outline: footprintOutline(part, pl.rot, size.h),
    });
  }
  if (out.length === 0) return null;
  return {
    sheet: { width: defaultSheet(project).width, height: defaultSheet(project).height },
    material: project.stock.material,
    sheets: project.layout.sheets.length,
    parts: out,
    utilisation: summarizeLayout(project).utilisationPercent,
  };
}

/** Days the home page waste summary looks back (T180). */
export const WASTE_WINDOW_DAYS = 30;
/** At most this many project bars in the waste chart (newest first). */
export const WASTE_MAX_BARS = 6;

/** The layout numbers of one project's report (`ReportSummary`, T177) the waste summary needs. */
export interface WasteInput {
  id: string;
  name: string;
  updatedAt: Date;
  summary: { sheetCount: number; wastePercent: number; wasteAreaM2: number; sheetAreaM2: number };
}

export interface WasteSummary {
  /** Projects with a layout changed in the window. */
  projects: number;
  sheets: number;
  wasteAreaM2: number;
  sheetAreaM2: number;
  /** Area-weighted: total waste area / total sheet area (not the mean of the project percents). */
  wastePercent: number;
  bars: { id: string; name: string; wastePercent: number; sheets: number; updatedAt: Date }[];
}

/**
 * Waste of the last `WASTE_WINDOW_DAYS` days (T180, D-070): every project whose layout was changed
 * in the window (`updatedAt`, newest first), from the same report numbers as the PDF. Null when no
 * project in the window has a layout.
 */
export function wasteSummary(rows: readonly WasteInput[], now: Date): WasteSummary | null {
  const since = now.getTime() - WASTE_WINDOW_DAYS * DAY_MS;
  const inWindow = rows
    .filter((r) => {
      const t = r.updatedAt.getTime();
      return r.summary.sheetCount > 0 && t > since && t <= now.getTime();
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
  if (inWindow.length === 0) return null;
  let sheets = 0;
  let wasteAreaM2 = 0;
  let sheetAreaM2 = 0;
  for (const r of inWindow) {
    sheets += r.summary.sheetCount;
    wasteAreaM2 += r.summary.wasteAreaM2;
    sheetAreaM2 += r.summary.sheetAreaM2;
  }
  return {
    projects: inWindow.length,
    sheets,
    wasteAreaM2,
    sheetAreaM2,
    wastePercent: sheetAreaM2 > 0 ? (100 * wasteAreaM2) / sheetAreaM2 : 0,
    bars: inWindow.slice(0, WASTE_MAX_BARS).map((r) => ({
      id: r.id,
      name: r.name,
      wastePercent: r.summary.wastePercent,
      sheets: r.summary.sheetCount,
      updatedAt: r.updatedAt,
    })),
  };
}

/**
 * Projects worth a card under "Son projeler" (P4, CTO #10): an untouched draft without parts is
 * not one; anything with parts or another status is.
 */
export function isRecentWorthy(p: {
  status: string;
  data: { parts: readonly unknown[] };
}): boolean {
  return p.status !== 'draft' || p.data.parts.length > 0;
}
