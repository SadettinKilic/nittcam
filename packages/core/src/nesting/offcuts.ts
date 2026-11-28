/**
 * Offcut stock (spec §6.2 "Artık parça", T168). Pure helpers:
 * - `proposeOffcuts`: after nesting, the rectangular leftovers of each sheet at least `min` mm on
 *   both sides. Only edge strips are proposed (right of and above every part), so each one comes
 *   off the sheet with one straight saw cut.
 * - `usableOffcuts`: the stored offcuts a project can nest on (same material and thickness,
 *   available, grain matching the sheet grain), as sheets in the sheet frame.
 */
import type { MaterialProps } from '../machine/material-props';
import { propsMatch } from '../machine/material-props-fields';
import { z } from 'zod';
import { defaultSheet, sheetSizeOf, type Project } from '../schema';
import { toCutSizes } from '../schema/cut-size';
import { partSpacing, placementRect } from './nest';
import { effectiveSpacing } from './tool';
import { partSizes } from './placement';

/** Default minimum offcut side, mm (spec §6.2: 300 × 300). */
export const OFFCUT_MIN_SIZE = 300;

/** An offcut as a nesting sheet (sheet frame: grain already matched). */
export const offcutSheetSchema = z.strictObject({
  id: z.string().min(1).max(64),
  width: z.number().positive().max(10_000),
  height: z.number().positive().max(10_000),
});
export type OffcutSheet = z.infer<typeof offcutSheetSchema>;

/** A leftover proposed for the stock; `x, y` is its bottom-left corner on layout sheet `sheet`. */
export interface OffcutProposal {
  sheet: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The sheet grain (0 | 90 | null); proposals exist only for these grains (offcuts table). */
  grain: 0 | 90 | null;
}

/** Stored offcut row as the helpers need it. */
export interface OffcutRow {
  id: string;
  material: string;
  thickness: number;
  width: number;
  height: number;
  grain: number | null;
  status: string;
  /** T350: alloy / colour code of the sheet it came from (absent or `{}` = none). */
  props?: MaterialProps | undefined;
}

/** Sheet grain as the offcuts table stores it; `undefined` = not storable (a free angle). */
function storableGrain(grain: number | null): 0 | 90 | null | undefined {
  if (grain === null) return null;
  if (grain === 0 || grain === 90) return grain;
  return undefined;
}

const round = (v: number): number => Math.floor(v * 10) / 10;

/**
 * Rectangular leftovers of the current layout, ≥ `min` mm on both sides. The used area of a sheet
 * is the bounding box of its parts inflated by the part spacing (tool radius + gap/2); the right
 * strip runs the full sheet height and the top strip the width left of it, or the other way round,
 * whichever pair keeps the larger single offcut. Sizes are rounded down to 0.1 mm.
 */
export function proposeOffcuts(
  entered: Project,
  toolDiameter: number,
  min = OFFCUT_MIN_SIZE,
): OffcutProposal[] {
  const project = toCutSizes(entered);
  const grain = storableGrain(defaultSheet(project).grain);
  if (grain === undefined) return [];
  const sizes = partSizes(project);
  const s = partSpacing(toolDiameter, effectiveSpacing(project, toolDiameter).gap);
  const out: OffcutProposal[] = [];
  project.layout.sheets.forEach((sheet, i) => {
    if (sheet.placements.length === 0) return;
    const { width: W, height: H } = sheetSizeOf(project, i);
    let maxX = 0;
    let maxY = 0;
    for (const pl of sheet.placements) {
      const r = placementRect(pl, sizes);
      if (!r) continue;
      maxX = Math.max(maxX, r.x + r.w + s);
      maxY = Math.max(maxY, r.y + r.h + s);
    }
    maxX = Math.min(W, maxX);
    maxY = Math.min(H, maxY);
    const rightTall = { x: maxX, y: 0, width: W - maxX, height: H };
    const topShort = { x: 0, y: maxY, width: maxX, height: H - maxY };
    const topWide = { x: 0, y: maxY, width: W, height: H - maxY };
    const rightShort = { x: maxX, y: 0, width: W - maxX, height: maxY };
    const area = (r: { width: number; height: number }) => r.width * r.height;
    const pair = area(rightTall) >= area(topWide) ? [rightTall, topShort] : [topWide, rightShort];
    for (const r of pair) {
      const width = round(r.width);
      const height = round(r.height);
      if (width >= min && height >= min)
        out.push({ sheet: i, x: r.x, y: r.y, width, height, grain });
    }
  });
  return out;
}

/**
 * Stored offcuts usable for `project` (T168): available, same material and thickness (T350: and the
 * same alloy or colour code when both sides have one), and a grain
 * that matches the sheet grain (an offcut stored at 90° on a 0° sheet is turned: width and height
 * swap). With a grained sheet an offcut without grain is skipped, and a sheet grain other than
 * 0°/90° uses no offcuts. Order: smallest area first, then id.
 */
export function usableOffcuts(
  project: Pick<Project, 'stock'>,
  rows: readonly OffcutRow[],
): OffcutSheet[] {
  const g = defaultSheet(project).grain;
  if (g !== null && g !== 0 && g !== 90) return [];
  const out: OffcutSheet[] = [];
  for (const r of rows) {
    if (r.status !== 'available') continue;
    if (r.material !== project.stock.material || r.thickness !== project.stock.thickness) continue;
    // T350: same alloy / colour code when both sides have one
    if (!propsMatch(project.stock.props, r.props)) continue;
    if (g === null || r.grain === g) out.push({ id: r.id, width: r.width, height: r.height });
    else if (r.grain === 0 || r.grain === 90)
      out.push({ id: r.id, width: r.height, height: r.width });
  }
  return out.sort((a, b) => a.width * a.height - b.width * b.height || (a.id < b.id ? -1 : 1));
}

/** Offcut ids the current layout cuts from (each at most once, in sheet order). */
export function usedOffcutIds(project: Pick<Project, 'layout'>): string[] {
  const ids: string[] = [];
  for (const sh of project.layout.sheets) {
    if (sh.offcutId && sh.placements.length > 0 && !ids.includes(sh.offcutId))
      ids.push(sh.offcutId);
  }
  return ids;
}
