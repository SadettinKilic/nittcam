/**
 * Which tool diameter nesting spaces parts for (D-019). Pure: the caller passes the profile.
 */
import { findMaterialParams, findTool, type MachineProfile } from '../machine';
import type { Stock } from '../schema';
import { TAB_BOUNDS } from '../toolpath/tabs';

/**
 * The cutting tool diameter for a stock on a machine: the suggested tool of the profile's material
 * set for the stock (material mapped to the profile kinds, D-029); otherwise the largest flat or compression end mill
 * (the safe side: more space between parts); otherwise the largest tool. `undefined` when the
 * profile has no tools.
 */
export function nestingToolDiameter(
  profile: Pick<MachineProfile, 'tools' | 'materials'>,
  stock: Pick<Stock, 'material' | 'thickness'>,
): number | undefined {
  const set = findMaterialParams(profile, stock);
  const suggested = set ? findTool(profile, set.tool) : undefined;
  if (suggested) return suggested.diameter;
  const cutters = profile.tools.filter((t) => t.type === 'flatEndMill' || t.type === 'compression');
  const pool = cutters.length > 0 ? cutters : profile.tools;
  if (pool.length === 0) return undefined;
  return Math.max(...pool.map((t) => t.diameter));
}

/**
 * Default clearance between two parts on top of the tool diameter, mm (T313, D-104): the clear
 * distance between neighbours is `toolDiameter + gap`, so with an 8 mm cutter two parts stand
 * 8.1 mm apart and the tool never grazes the neighbour's finished edge. `nesting.gap` holds it per
 * project; the company default (Ayarlar) can change it for new projects.
 */
export const DEFAULT_PART_CLEARANCE = 0.1;

/** The clear distance the placer keeps between two parts' edges, mm (D-019: tool + gap). */
export function partClearDistance(toolDiameter: number, gap: number): number {
  return toolDiameter + gap;
}

/**
 * D-129 (T338): a tab holds only with at least `TAB_BOUNDS.minAnchor` (3 mm) of material beyond
 * its kerf. With tabs (no thin skin, "Köprü" on) nesting therefore keeps
 * - the sheet margin at least Ø + 3 (one kerf of Ø, then the 3 mm web), and
 * - the clearance (pay) at least Ø + 3 + 0.1: between two parts lie two kerfs, so the clear
 *   distance Ø + pay must reach 2Ø + 3 for a 3 mm web; the 0.1 mm (D-104) keeps the web strictly
 *   above 3 mm, as the predicate (`tabHolds`, r + 0.005 slack) requires.
 * The stored project values are not rewritten; `raised` says which value was lifted (the Dizilim
 * note). With thin skin nothing changes (D-104). No tool known (0): the margin stays as stored.
 */
export interface EffectiveSpacing {
  gap: number;
  margin: number;
  raised: { gap: boolean; margin: boolean };
}

export function effectiveSpacing(
  project: { nesting: { gap: number; margin: number }; cutting: { skin?: unknown } },
  toolDiameter: number,
): EffectiveSpacing {
  const { gap, margin } = project.nesting;
  if (project.cutting.skin !== undefined) {
    return { gap, margin, raised: { gap: false, margin: false } };
  }
  const minGap = toolDiameter + TAB_BOUNDS.minAnchor + DEFAULT_PART_CLEARANCE;
  const minMargin = toolDiameter > 0 ? toolDiameter + TAB_BOUNDS.minAnchor : 0;
  return {
    gap: Math.max(gap, minGap),
    margin: Math.max(margin, minMargin),
    raised: { gap: gap < minGap, margin: margin < minMargin },
  };
}
