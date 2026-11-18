/** Phone mini-toolbar placement helpers (B10a). */

/** Gap kept between the mini-toolbar and the tool rail, px. */
const RAIL_GAP = 4;

export interface Rect {
  left: number;
  top: number;
  w: number;
  h: number;
}

/**
 * Moves the mini-toolbar off the tool rail (B10a): first to the right of the rail, then below it,
 * staying inside the canvas (`maxLeft` / `maxTop`). Unchanged when they do not intersect.
 */
export function miniBarRailClear(
  bar: Rect,
  rail: Rect,
  bounds: { maxLeft: number; maxTop: number },
): { left: number; top: number } {
  const hits = (b: Rect) =>
    rail.w > 0 &&
    rail.h > 0 &&
    b.left < rail.left + rail.w + RAIL_GAP &&
    rail.left - RAIL_GAP < b.left + b.w &&
    b.top < rail.top + rail.h + RAIL_GAP &&
    rail.top - RAIL_GAP < b.top + b.h;
  if (!hits(bar)) return { left: bar.left, top: bar.top };
  const right = rail.left + rail.w + RAIL_GAP;
  if (right <= bounds.maxLeft) return { left: right, top: bar.top };
  const below = rail.top + rail.h + RAIL_GAP;
  if (below <= bounds.maxTop) return { left: bar.left, top: below };
  return { left: bar.left, top: bar.top };
}
