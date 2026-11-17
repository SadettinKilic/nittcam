/**
 * Ana sayfa (spec §3.4, T106): pure helpers that turn the company's projects, machines and exports
 * into the dashboard's numbers, the machine list order and the layout thumbnails.
 */
import { partBoxSize, type Project, type VerificationState } from '@nittcam/core';

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
  sheets: number;
  parts: { x: number; y: number; w: number; h: number }[];
}

/** At most this many parts are drawn in a thumbnail (it is a hint, not a preview). */
export const THUMB_MAX_PARTS = 200;

/**
 * The thumbnail of a project's first sheet, or null when the project has no layout yet. Placements
 * of unknown parts are skipped; at most `THUMB_MAX_PARTS` parts are kept.
 */
export function layoutThumb(project: Project): LayoutThumb | null {
  const first = project.layout.sheets[0];
  if (!first || first.placements.length === 0) return null;
  const parts = new Map(project.parts.map((p) => [p.id, p]));
  const out: LayoutThumb['parts'] = [];
  for (const pl of first.placements) {
    if (out.length >= THUMB_MAX_PARTS) break;
    const part = parts.get(pl.partId);
    if (!part) continue;
    const size = partBoxSize(part);
    const turned = pl.rot === 90 || pl.rot === 270;
    out.push({ x: pl.x, y: pl.y, w: turned ? size.h : size.w, h: turned ? size.w : size.h });
  }
  if (out.length === 0) return null;
  return {
    sheet: { width: project.stock.sheet.width, height: project.stock.sheet.height },
    sheets: project.layout.sheets.length,
    parts: out,
  };
}
