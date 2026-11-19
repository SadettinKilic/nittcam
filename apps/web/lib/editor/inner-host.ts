/**
 * Inner contours from the drawing tools (T134, spec §4.3): a closed shape drawn inside a part can
 * become that part's cut-out. Pure helpers: the drawn shape in board millimetres, and the part
 * it lies in.
 */
import { checkInnerContour, rectOutline, type BoardPart, type Vertex } from '@nittcam/core';
import type { DrawnShape } from './draw-tool';

/** The drawn shape as a closed contour in board millimetres. */
export function shapeVertices(shape: DrawnShape): Vertex[] {
  const local =
    shape.shape.kind === 'rect' ? rectOutline(shape.shape.params) : shape.shape.vertices;
  return local.map((v) => ({ x: v.x + shape.at.x, y: v.y + shape.at.y, bulge: v.bulge }));
}

/**
 * The part whose outline holds the shape (the topmost, i.e. last drawn, when several do), or null.
 * A shape that overlaps an existing cut-out or is too small still counts as "inside": the user is
 * asked, and the reason is shown when the cut-out cannot be added.
 */
export function innerHost(parts: readonly BoardPart[], vs: readonly Vertex[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i] as BoardPart;
    const err = checkInnerContour(p.outline, p.inners, vs, 0);
    if (err === undefined || err === 'overlap') return p.id;
  }
  return null;
}
