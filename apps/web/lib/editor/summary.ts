import { boardBox, signedArea, type BoardPart } from '@nittcam/core';

export interface BoardSummary {
  /** Parts on the board (rows of the cut list). */
  parts: number;
  /** Pieces to cut (sum of quantities). */
  pieces: number;
  /** Net area of all pieces (outline minus inner contours, × quantity), m². */
  areaM2: number;
  /** Width × height of the board's bounding box, mm; null without parts. */
  extents: { w: number; h: number } | null;
}

/**
 * Compact inspector summary with nothing selected (T242): counts, total area and extents. View
 * data only; arcs are measured exactly (`signedArea`).
 */
export function boardSummary(
  parts: readonly BoardPart[],
  qty: ReadonlyMap<string, number>,
): BoardSummary {
  let pieces = 0;
  let mm2 = 0;
  for (const p of parts) {
    const n = qty.get(p.id) ?? 1;
    pieces += n;
    let a = Math.abs(signedArea({ vertices: p.outline, closed: true }));
    for (const inner of p.inners) a -= Math.abs(signedArea({ vertices: inner, closed: true }));
    mm2 += Math.max(0, a) * n;
  }
  const box = boardBox(parts);
  return {
    parts: parts.length,
    pieces,
    areaM2: mm2 / 1_000_000,
    extents: box ? { w: box.maxX - box.minX, h: box.maxY - box.minY } : null,
  };
}
