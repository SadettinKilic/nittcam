/**
 * Stage of the 3D preview (T152, spec §3.8): the machine table and the sheet with their real
 * sizes, in the sheet frame (mm, X right, Y away from the operator, Z up; spec §6.1). Pure data;
 * the scene turns it into meshes.
 */

/** Machine table and where program zero sits (from the machine profile; spec §7.1). */
export interface TableSpec {
  width: number;
  depth: number;
  corner: 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';
  /** Sheet corner offset from program zero, mm. */
  sheetOffset: { x: number; y: number };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margin around the sheet when the machine (table) is unknown, mm. */
export const NO_TABLE_MARGIN = 150;
/** Thickness of the drawn table top (spoilboard + bed), mm. */
export const TABLE_THICKNESS = 40;

/**
 * The table rectangle in the sheet frame. The sheet corner nearest program zero sits at
 * `sheetOffset` from the table corner (frontLeft = sheet bottom-left; the other corners mirror
 * it). Without a machine the table is the sheet plus a margin.
 */
export function tableRect(sheet: { width: number; height: number }, table: TableSpec | null): Rect {
  if (!table) {
    const m = NO_TABLE_MARGIN;
    return { x: -m, y: -m, w: sheet.width + 2 * m, h: sheet.height + 2 * m };
  }
  const { width: tw, depth: td, corner, sheetOffset: o } = table;
  const right = corner === 'frontRight' || corner === 'backRight';
  const back = corner === 'backLeft' || corner === 'backRight';
  const x = right ? sheet.width + o.x - tw : -o.x;
  const y = back ? sheet.height + o.y - td : -o.y;
  return { x, y, w: tw, h: td };
}

/** Projected stock for the preview: sheet size + thickness + table. */
export interface Stage {
  sheet: { width: number; height: number };
  thickness: number;
  table: Rect;
}

export function buildStage(
  sheet: { width: number; height: number },
  thickness: number,
  table: TableSpec | null,
): Stage {
  return {
    sheet: { width: sheet.width, height: sheet.height },
    thickness,
    table: tableRect(sheet, table),
  };
}

/** The table spec of a machine profile (or null without a machine). */
export function tableSpecOf(
  profile: {
    table: { width: number; depth: number };
    origin: { corner: TableSpec['corner']; sheetOffset: { x: number; y: number } };
  } | null,
): TableSpec | null {
  if (!profile) return null;
  return {
    width: profile.table.width,
    depth: profile.table.depth,
    corner: profile.origin.corner,
    sheetOffset: { x: profile.origin.sheetOffset.x, y: profile.origin.sheetOffset.y },
  };
}
