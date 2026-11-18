/**
 * Drawing board (T124, spec §4.2, D-037): where each part sits on the editor's board and its
 * geometry in board millimetres (Y up). Pure: the same project always gives the same board.
 *
 * A part with `draw` sits at that position (the board coordinates of its local origin). Parts
 * without it are arranged automatically in rows, in list order, below the placed ones, so a
 * fresh cut list appears as a tidy board without any command having run.
 */
import { bbox, contour } from '../geometry/polyline';
import type { BBox, Point } from '../geometry/types';
import { deriveOutline } from '../schema/outline';
import type { Hole, Part, Project, Vertex } from '../schema/project';

/** Gap between automatically arranged parts, mm. */
export const BOARD_GAP = 50;
/** Row width of the automatic arrangement, mm (about one sheet). */
export const BOARD_ROW = 2800;

/** A part as the board draws it: everything in board millimetres, Y up. */
export interface BoardPart {
  id: string;
  /** Position of the part's local origin on the board. */
  at: Point;
  /** True when the position comes from `draw` (moved by the user), false when auto-arranged. */
  placed: boolean;
  /** Outer contour (CCW) in board coordinates. */
  outline: Vertex[];
  /** Inner contours (CW) in board coordinates. */
  inners: Vertex[][];
  /** Hole centres and diameters in board coordinates. */
  holes: { id: string; x: number; y: number; d: number }[];
  /** Bounding box in board coordinates. */
  box: BBox;
}

/** Local bounding box of a part (its outline in the part frame). */
export function localBox(part: Part): BBox {
  return bbox(contour(deriveOutline(part)));
}

function shift(vs: readonly Vertex[], dx: number, dy: number): Vertex[] {
  return vs.map((v) => ({ x: v.x + dx, y: v.y + dy, bulge: v.bulge }));
}

/** Board position of every part's local origin, by part id. */
export function boardPositions(project: Project): Map<string, Point> {
  const out = new Map<string, Point>();
  let placedMinY = Infinity;
  for (const part of project.parts) {
    if (!part.draw) continue;
    const box = localBox(part);
    out.set(part.id, { x: part.draw.x, y: part.draw.y });
    placedMinY = Math.min(placedMinY, part.draw.y + box.minY);
  }
  // Rows run downwards from the top: from just below the placed parts, else from y = 0 and the
  // block is then lifted so the board starts at the origin (all coordinates positive).
  const anyPlaced = Number.isFinite(placedMinY);
  let top = anyPlaced ? placedMinY - BOARD_GAP : 0;
  const auto: string[] = [];
  let x = 0;
  let rowH = 0;
  for (const part of project.parts) {
    if (part.draw) continue;
    const box = localBox(part);
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (x > 0 && x + w > BOARD_ROW) {
      top -= rowH + BOARD_GAP;
      x = 0;
      rowH = 0;
    }
    // Place the local box's top-left corner at (x, top).
    out.set(part.id, { x: x - box.minX, y: top - h - box.minY });
    auto.push(part.id);
    x += w + BOARD_GAP;
    rowH = Math.max(rowH, h);
  }
  if (!anyPlaced && auto.length > 0) {
    const lift = rowH - top;
    for (const id of auto) {
      const at = out.get(id);
      if (at) out.set(id, { x: at.x, y: at.y + lift });
    }
  }
  return out;
}

function holeCentre(hole: Hole, at: Point) {
  return { id: hole.id, x: hole.cx + at.x, y: hole.cy + at.y, d: hole.d };
}

/** Every part as drawn on the board, in project order. */
export function boardParts(project: Project): BoardPart[] {
  const pos = boardPositions(project);
  return project.parts.map((part) => {
    const at = pos.get(part.id) ?? { x: 0, y: 0 };
    const local = localBox(part);
    return {
      id: part.id,
      at,
      placed: part.draw !== undefined,
      outline: shift(deriveOutline(part), at.x, at.y),
      inners: part.inners.map((c) => shift(c, at.x, at.y)),
      holes: part.holes.map((h) => holeCentre(h, at)),
      box: {
        minX: local.minX + at.x,
        minY: local.minY + at.y,
        maxX: local.maxX + at.x,
        maxY: local.maxY + at.y,
      },
    };
  });
}

/** Bounding box of all parts on the board; undefined for an empty project. */
export function boardBox(parts: readonly BoardPart[]): BBox | undefined {
  if (parts.length === 0) return undefined;
  return parts.reduce<BBox>(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.box.minX),
      minY: Math.min(acc.minY, p.box.minY),
      maxX: Math.max(acc.maxX, p.box.maxX),
      maxY: Math.max(acc.maxY, p.box.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}
