/**
 * Which tool diameter nesting spaces parts for (D-019). Pure: the caller passes the profile.
 */
import { findTool, type MachineProfile } from '../machine';
import type { Stock } from '../schema';

/**
 * The cutting tool diameter for a stock on a machine: the suggested tool of the profile's material
 * set with the same material and thickness; otherwise the largest flat or compression end mill
 * (the safe side: more space between parts); otherwise the largest tool. `undefined` when the
 * profile has no tools.
 */
export function nestingToolDiameter(
  profile: Pick<MachineProfile, 'tools' | 'materials'>,
  stock: Pick<Stock, 'material' | 'thickness'>,
): number | undefined {
  const set = profile.materials.find(
    (m) => m.material === stock.material && m.thickness === stock.thickness,
  );
  const suggested = set ? findTool(profile, set.tool) : undefined;
  if (suggested) return suggested.diameter;
  const cutters = profile.tools.filter((t) => t.type === 'flatEndMill' || t.type === 'compression');
  const pool = cutters.length > 0 ? cutters : profile.tools;
  if (pool.length === 0) return undefined;
  return Math.max(...pool.map((t) => t.diameter));
}
