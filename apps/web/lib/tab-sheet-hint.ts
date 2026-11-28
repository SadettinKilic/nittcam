import {
  effectiveSpacing,
  holdLimitsOf,
  skinThicknessOk,
  type LayoutSummary,
  type Project,
} from '@nittcam/core';

/**
 * T428 (CTO #15 S6): tabs widen the gaps (D-129) and can cost a whole sheet. When the last sheet of
 * a tab layout is nearly empty, the Dizilim step nests the same project once more with thin skin
 * (the stored, smaller clearance and margin count again) and, when that needs fewer sheets, says so
 * with one "Uygula" button. The placer is not changed; the probe is an ordinary run.
 */

/** The last sheet counts as nearly empty below this utilisation, percent. */
export const TAB_EXTRA_SHEET_MAX_USE = 15;

/** The skin the "Uygula" button sets: as the "ince tabaka" switch (0,5 mm, at most half the sheet). */
export function hintSkinThickness(stockThickness: number): number {
  return Math.min(0.5, stockThickness / 2);
}

/**
 * The thin-skin variant of `project` to nest as a probe, or null when no hint can apply: thin skin
 * already on, no tool, the tab spacing not raised, a material without thin skin (ACM) or a sheet too
 * thin for one, a single sheet, unplaced copies, or a last sheet used at or above
 * `TAB_EXTRA_SHEET_MAX_USE` %.
 */
export function tabSheetProbe(
  project: Project,
  toolDiameter: number,
  summary: LayoutSummary | undefined,
): Project | null {
  if (!summary || project.cutting.skin !== undefined || !(toolDiameter > 0)) return null;
  const spacing = effectiveSpacing(project, toolDiameter);
  if (!spacing.raised.gap && !spacing.raised.margin) return null;
  const limits = holdLimitsOf(project.stock.material);
  const skin = hintSkinThickness(project.stock.thickness);
  if (!limits.skin.offered || !skinThicknessOk(skin, project.stock.thickness, limits)) return null;
  if (summary.sheetCount < 2 || summary.unplaced.length > 0) return null;
  const last = summary.sheets[summary.sheets.length - 1];
  if (!last || last.sheetArea <= 0) return null;
  if ((100 * last.partArea) / last.sheetArea >= TAB_EXTRA_SHEET_MAX_USE) return null;
  return { ...project, cutting: { ...project.cutting, skin: { thickness: skin } } };
}

/** The sheet count the hint offers, or null when the thin-skin probe saves no sheet. */
export function tabSheetSaving(
  current: Pick<LayoutSummary, 'sheetCount'>,
  probe: Pick<LayoutSummary, 'sheetCount' | 'unplaced'> | undefined,
): number | null {
  if (!probe || probe.unplaced.length > 0) return null;
  return probe.sheetCount < current.sheetCount ? probe.sheetCount : null;
}
