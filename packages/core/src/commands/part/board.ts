/**
 * Drawing-board edit commands (T125, spec §4.2, §4.4, D-037): move, mirror, rotate, paste and
 * remove parts. Each is one undo step. Board edits are UI commands, not AI tools. Before an edit the board is "frozen": every part without
 * a `draw` position gets its current auto position, so editing one part never moves the others.
 */
import type { Draft } from 'immer';
import { z } from 'zod';
import { contour, normalize } from '../../geometry/polyline';
import { mirrorGrain, turnGrain } from '../../geometry/grain';
import { mirror, rotate, rotatePoint, translate, type QuarterTurn } from '../../geometry/transform';
import type { Point, Polyline } from '../../geometry/types';
import { boardPositions, localBox } from '../../editor/board';
import { partSchema, rectPartSchema, type Part, type Project, type Vertex } from '../../schema';
import { defineCommand } from '../types';

const idList = z
  .array(rectPartSchema.shape.id)
  .min(1, { error: 'give at least one part id' })
  .max(2000, { error: 'at most 2000 parts at once' });

const mm = z.number({ error: 'must be a finite number (mm)' });

function missing(project: Project, ids: readonly string[]): string | undefined {
  const have = new Set(project.parts.map((p) => p.id));
  const gone = ids.find((id) => !have.has(id));
  return gone === undefined ? undefined : `no part with id "${gone}"`;
}

/** Writes the auto positions of unplaced parts into `draw` (see D-037). */
export function freezeBoard(draft: Draft<Project>): void {
  const pos = boardPositions(draft as Project);
  for (const part of draft.parts) {
    if (part.draw) continue;
    const at = pos.get(part.id);
    if (at) part.draw = { x: at.x, y: at.y };
  }
}

function poly(vs: readonly Vertex[]): Polyline {
  return contour(vs.map((v) => ({ ...v })));
}

/** Moves parts on the board by (dx, dy) mm. */
export const movePart = defineCommand({
  name: 'movePart',
  area: 'part',
  description:
    'Move parts on the drawing board by dx, dy millimetres (X right, Y up). Board position ' +
    'only; it does not change the nesting layout.',
  aiTool: false,
  params: z.strictObject({ ids: idList, dx: mm, dy: mm }),
  check: (project, params) => missing(project, params.ids),
  apply: (draft, params) => {
    freezeBoard(draft);
    const ids = new Set(params.ids);
    for (const part of draft.parts) {
      if (!ids.has(part.id) || !part.draw) continue;
      part.draw = { x: part.draw.x + params.dx, y: part.draw.y + params.dy };
    }
  },
});

type Mapper = (p: Point) => Point;

/** Applies a point mapping to everything inside the part frame; contours are re-normalised. */
function mapPart(
  part: Draft<Part>,
  map: Mapper,
  contourMap: (pl: Polyline) => Polyline,
  swap: boolean,
): void {
  for (const h of part.holes) {
    const c = map({ x: h.cx, y: h.cy });
    h.cx = c.x;
    h.cy = c.y;
  }
  part.inners = part.inners.map((c) => normalize(contourMap(poly(c)), 'inner').vertices);
  if (part.kind === 'rect') {
    if (swap) part.params = { w: part.params.h, h: part.params.w, r: part.params.r };
    // The outline is only a cache of params (D-010).
    if (part.outline !== undefined) delete part.outline;
  } else {
    part.outline = normalize(contourMap(poly(part.outline)), 'outer').vertices;
  }
}

/** Mirrors parts in place: `h` flips left ↔ right, `v` flips top ↔ bottom. */
export const mirrorPart = defineCommand({
  name: 'mirrorPart',
  area: 'part',
  description:
    'Mirror parts in place: axis "h" flips left/right, "v" flips top/bottom. Holes, cut-outs ' +
    'and edge bands follow; the outline keeps its stored direction.',
  aiTool: false,
  params: z.strictObject({
    ids: idList,
    axis: z.enum(['h', 'v'], { error: 'axis is "h" or "v"' }),
  }),
  check: (project, params) => missing(project, params.ids),
  apply: (draft, params) => {
    freezeBoard(draft);
    const ids = new Set(params.ids);
    for (const part of draft.parts) {
      if (!ids.has(part.id)) continue;
      const b = localBox(part as Part);
      const h = params.axis === 'h';
      const sx = b.minX + b.maxX;
      const sy = b.minY + b.maxY;
      const map: Mapper = (p) => (h ? { x: sx - p.x, y: p.y } : { x: p.x, y: sy - p.y });
      const contourMap = (pl: Polyline) =>
        h ? translate(mirror(pl, 'x'), sx, 0) : translate(mirror(pl, 'y'), 0, sy);
      mapPart(part, map, contourMap, false);
      const band = part.edgeBand;
      part.edgeBand = h
        ? { ...band, left: band.right, right: band.left }
        : { ...band, top: band.bottom, bottom: band.top };
      // Grain follows the piece (D-038): a mirror reflects the grain line, a → −a (mod 180).
      const grain = mirrorGrain(part.grain.angle);
      if (grain !== part.grain.angle) part.grain.angle = grain;
    }
  },
});

/** Offset that brings a CCW-rotated local box back to its old lower-left corner. */
function rotationShift(turns: QuarterTurn, w: number, h: number): Point {
  switch (turns) {
    case 90:
      return { x: h, y: 0 };
    case 180:
      return { x: w, y: h };
    case 270:
      return { x: 0, y: w };
    default:
      return { x: 0, y: 0 };
  }
}

/** Rotates parts by quarter turns (CCW) about their centre on the board. */
export const rotatePart = defineCommand({
  name: 'rotatePart',
  area: 'part',
  description:
    'Rotate parts by 90, 180 or 270 degrees counter-clockwise about their centre on the board. ' +
    'Holes, cut-outs, edge bands and the grain direction rotate with the part.',
  aiTool: false,
  params: z.strictObject({
    ids: idList,
    turns: z.union([z.literal(90), z.literal(180), z.literal(270)]).default(90),
  }),
  check: (project, params) => missing(project, params.ids),
  apply: (draft, params) => {
    freezeBoard(draft);
    const ids = new Set(params.ids);
    const turns = params.turns as QuarterTurn;
    for (const part of draft.parts) {
      if (!ids.has(part.id)) continue;
      const b = localBox(part as Part);
      const w = b.maxX - b.minX;
      const h = b.maxY - b.minY;
      const s = rotationShift(turns, w, h);
      const map: Mapper = (p) => {
        const r = rotatePoint({ x: p.x - b.minX, y: p.y - b.minY }, turns);
        return { x: r.x + s.x + b.minX, y: r.y + s.y + b.minY };
      };
      const contourMap = (pl: Polyline) =>
        translate(rotate(translate(pl, -b.minX, -b.minY), turns), s.x + b.minX, s.y + b.minY);
      const swap = turns !== 180;
      mapPart(part, map, contourMap, swap);
      // Edge bands turn with the sides: CCW 90° sends right → top → left → bottom → right.
      const e = part.edgeBand;
      part.edgeBand =
        turns === 90
          ? { top: e.right, right: e.bottom, bottom: e.left, left: e.top }
          : turns === 180
            ? { top: e.bottom, right: e.left, bottom: e.top, left: e.right }
            : { top: e.left, right: e.top, bottom: e.right, left: e.bottom };
      // Grain follows the piece (D-038): the grain line turns with the shape.
      const grain = turnGrain(part.grain.angle, turns);
      if (grain !== part.grain.angle) part.grain.angle = grain;
      // Keep the centre: the box swaps width and height around it.
      const w2 = swap ? h : w;
      const h2 = swap ? w : h;
      if (part.draw) {
        part.draw = { x: part.draw.x + (w - w2) / 2, y: part.draw.y + (h - h2) / 2 };
      }
    }
  },
});

/**
 * Adds copies of parts (clipboard paste, Ctrl+D) at the end of the list, one undo step. The
 * caller sends complete part data with fresh ids (core is pure: no random ids) and their board
 * positions.
 */
export const pasteParts = defineCommand({
  name: 'pasteParts',
  area: 'part',
  description: 'Add complete part copies (with new ids and board positions) in one step.',
  aiTool: false,
  params: z.strictObject({
    parts: z.array(partSchema).min(1, { error: 'give at least one part' }).max(2000),
  }),
  check: (project, params) => {
    const taken = new Set(project.parts.map((p) => p.id));
    for (const p of params.parts) {
      if (taken.has(p.id)) return `a part with id "${p.id}" already exists`;
      taken.add(p.id);
    }
    return undefined;
  },
  apply: (draft, params) => {
    freezeBoard(draft);
    for (const p of params.parts) draft.parts.push(JSON.parse(JSON.stringify(p)) as Part);
  },
});

/** Removes several parts (and their layout placements) in one undo step. */
export const removeParts = defineCommand({
  name: 'removeParts',
  area: 'part',
  description: 'Remove several parts by id in one step (their layout placements go too).',
  aiTool: false,
  params: z.strictObject({ ids: idList }),
  check: (project, params) => missing(project, params.ids),
  apply: (draft, params) => {
    const ids = new Set(params.ids);
    draft.parts = draft.parts.filter((p) => !ids.has(p.id));
    for (const sheet of draft.layout.sheets) {
      const keep = sheet.placements.filter((pl) => !ids.has(pl.partId));
      if (keep.length !== sheet.placements.length) sheet.placements = keep;
    }
  },
});
