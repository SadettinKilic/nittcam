/**
 * Which tool diameter nesting spaces parts for (D-019). Pure: the caller passes the profile.
 */
import { findMaterialParams, findTool, type MachineProfile } from '../machine';
import type { Stock } from '../schema';

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
 * Default clearance between two parts on top of the tool diameter, mm (T313, D-103): the clear
 * distance between neighbours is `toolDiameter + gap`, so with an 8 mm cutter two parts stand
 * 8.1 mm apart and the tool never grazes the neighbour's finished edge. `nesting.gap` holds it per
 * project; the company default (Ayarlar) can change it for new projects.
 */
export const DEFAULT_PART_CLEARANCE = 0.1;

/** The clear distance the placer keeps between two parts' edges, mm (D-019: tool + gap). */
export function partClearDistance(toolDiameter: number, gap: number): number {
  return toolDiameter + gap;
}
