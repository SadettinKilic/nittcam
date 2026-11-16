import type { Part, RectParams, Vertex } from './project';

/** Bulge of a 90° arc: tan(90° / 4). */
export const QUARTER_ARC_BULGE = Math.tan(Math.PI / 8);

/**
 * Outline of a parametric rectangle in its local frame: bottom-left at (0, 0), CCW, closed
 * implicitly (the last vertex connects to the first). Rounded corners are quarter arcs
 * (bulge tan(22.5°)). Zero-length straight edges (r = w/2 or r = h/2) are dropped.
 */
export function rectOutline({ w, h, r }: RectParams): Vertex[] {
  if (r === 0) {
    return [
      { x: 0, y: 0, bulge: 0 },
      { x: w, y: 0, bulge: 0 },
      { x: w, y: h, bulge: 0 },
      { x: 0, y: h, bulge: 0 },
    ];
  }
  const b = QUARTER_ARC_BULGE;
  const raw: Vertex[] = [
    { x: r, y: 0, bulge: 0 }, // bottom edge
    { x: w - r, y: 0, bulge: b }, // bottom-right corner
    { x: w, y: r, bulge: 0 }, // right edge
    { x: w, y: h - r, bulge: b }, // top-right corner
    { x: w - r, y: h, bulge: 0 }, // top edge
    { x: r, y: h, bulge: b }, // top-left corner
    { x: 0, y: h - r, bulge: 0 }, // left edge
    { x: 0, y: r, bulge: b }, // bottom-left corner
  ];
  // A straight edge of length 0 shows up as a line vertex equal to the next vertex.
  return raw.filter((v, i) => {
    const next = raw[(i + 1) % raw.length] as Vertex;
    return !(v.bulge === 0 && v.x === next.x && v.y === next.y);
  });
}

/**
 * The part's outer contour. For `rect` parts `params` is the source and the outline is derived
 * (any stored `outline` is ignored); for `freeform` parts the stored `outline` is the source.
 */
export function deriveOutline(part: Part): Vertex[] {
  if (part.kind === 'rect') return rectOutline(part.params);
  return part.outline.map((v) => ({ ...v }));
}
