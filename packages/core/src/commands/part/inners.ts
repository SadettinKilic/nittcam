/**
 * Inner contour commands (T134, spec §4.3 "İç konturlar (pencere, boşluk)", §6.1): add a cut-out
 * drawn inside a part, remove one. One undo step each. Board edits are UI commands, not AI tools.
 */
import { z } from 'zod';
import { boardPositions } from '../../editor/board';
import { tidy } from '../../editor/draw';
import { checkInnerContour, normalizeInner, type InnerContourError } from '../../editor/inners';
import {
  contourSchema,
  deriveOutline,
  rectPartSchema,
  type Project,
  type Vertex,
} from '../../schema';
import { bbox, contour } from '../../geometry/polyline';
import { defineCommand } from '../types';
import { freezeBoard } from './board';

const ERRORS: Record<InnerContourError, string> = {
  degenerate: 'the inner contour has no area',
  crossing: 'the inner contour crosses itself',
  outside: 'the inner contour must lie inside the part outline',
  overlap: 'the inner contour touches or overlaps another inner contour',
  tooSmall: 'the inner contour is too small or too narrow for the tool',
};

function toLocal(vs: readonly Vertex[], at: { x: number; y: number }): Vertex[] {
  return vs.map((v) => ({ x: tidy(v.x - at.x), y: tidy(v.y - at.y), bulge: v.bulge }));
}

const params = z.strictObject({
  id: rectPartSchema.shape.id,
  /** Closed contour in board millimetres (as drawn); stored CW in the part frame. */
  vertices: contourSchema,
  /** Cutting tool diameter, mm: the opening must let the tool through (0 = not checked). */
  toolDiameter: z
    .number({ error: 'tool diameter must be a finite number (mm)' })
    .nonnegative({ error: 'tool diameter must not be negative' })
    .default(0),
});

function prepare(project: Project, p: z.output<typeof params>) {
  const part = project.parts.find((x) => x.id === p.id);
  const at = boardPositions(project).get(p.id);
  if (!part || !at) return { error: `no part with id "${p.id}"` } as const;
  const local = toLocal(p.vertices, at);
  const err = checkInnerContour(deriveOutline(part), part.inners, local, p.toolDiameter);
  return err ? ({ error: ERRORS[err] } as const) : ({ local } as const);
}

/** Adds a closed shape drawn inside a part as an inner contour (cut-out) of that part. */
export const addInnerContour = defineCommand({
  name: 'addInnerContour',
  area: 'part',
  description:
    'Add a closed contour drawn inside a part (board mm) as an inner contour (cut-out). It must ' +
    'lie inside the outline, not overlap other inner contours and let the tool through.',
  aiTool: false,
  params,
  check: (project, p) => {
    const r = prepare(project, p);
    return 'error' in r ? r.error : undefined;
  },
  apply: (draft, p) => {
    const r = prepare(draft as Project, p);
    if ('error' in r) return;
    freezeBoard(draft);
    const part = draft.parts.find((x) => x.id === p.id);
    part?.inners.push(normalizeInner(r.local));
  },
});

/** Removes inner contour `index` of a part. */
export const removeInnerContour = defineCommand({
  name: 'removeInnerContour',
  area: 'part',
  description: 'Remove an inner contour (cut-out) of a part by its index.',
  aiTool: false,
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    index: z.number().int({ error: 'index must be an integer' }).min(0),
  }),
  check: (project, p) => {
    const part = project.parts.find((x) => x.id === p.id);
    if (!part) return `no part with id "${p.id}"`;
    return p.index < part.inners.length ? undefined : 'no such inner contour';
  },
  apply: (draft, p) => {
    const part = draft.parts.find((x) => x.id === p.id);
    if (!part || p.index >= part.inners.length) return;
    part.inners.splice(p.index, 1);
    // The operation overrides (T142) stay with their contours.
    const ops = part.ops?.inners;
    if (part.ops && ops) {
      if (p.index < ops.length) ops.splice(p.index, 1);
      while (ops.length > 0 && ops[ops.length - 1] === null) ops.pop();
      if (ops.length === 0) delete part.ops.inners;
      if (part.ops.outline === undefined && part.ops.inners === undefined) delete part.ops;
    }
  },
});

const innerBox = z.strictObject({
  id: rectPartSchema.shape.id,
  index: z.number().int({ error: 'index must be an integer' }).min(0),
  /** New lower-left corner of the contour's box, part frame (mm). Omitted = unchanged. */
  x: z.number({ error: 'x must be a finite number (mm)' }).optional(),
  y: z.number({ error: 'y must be a finite number (mm)' }).optional(),
  /** New box size (mm). Omitted = unchanged; a contour with arcs scales uniformly. */
  width: z.number({ error: 'width must be a finite number (mm)' }).positive().optional(),
  height: z.number({ error: 'height must be a finite number (mm)' }).positive().optional(),
  toolDiameter: z.number().nonnegative().default(0),
});

/** Inner contour `index` moved / resized to the requested box (part frame), or an error. */
export function placedInner(
  project: Project,
  p: z.output<typeof innerBox>,
): { error: string } | { vertices: Vertex[] } {
  const part = project.parts.find((x) => x.id === p.id);
  if (!part) return { error: `no part with id "${p.id}"` };
  const inner = part.inners[p.index];
  if (!inner) return { error: 'no such inner contour' };
  // The true box (arcs included), the one the panel shows.
  const { minX, minY, maxX, maxY } = bbox(contour(inner));
  const w0 = maxX - minX;
  const h0 = maxY - minY;
  const arcs = inner.some((v) => v.bulge !== 0);
  let sx = p.width !== undefined && w0 > 0 ? p.width / w0 : 1;
  let sy = p.height !== undefined && h0 > 0 ? p.height / h0 : 1;
  if (arcs) {
    // A bulge arc stays an arc only under a uniform scale (B52, D-092).
    if (p.width !== undefined && p.height === undefined) sy = sx;
    else if (p.height !== undefined && p.width === undefined) sx = sy;
    else if (Math.abs(sx - sy) > 1e-6) {
      return { error: 'an inner contour with arcs keeps its proportions (scale uniformly)' };
    }
  }
  const x0 = p.x ?? minX;
  const y0 = p.y ?? minY;
  const vertices = inner.map((v) => ({
    x: tidy(x0 + (v.x - minX) * sx),
    y: tidy(y0 + (v.y - minY) * sy),
    bulge: v.bulge,
  }));
  const others = part.inners.filter((_, i) => i !== p.index);
  const err = checkInnerContour(deriveOutline(part), others, vertices, p.toolDiameter);
  return err ? { error: ERRORS[err] } : { vertices };
}

/**
 * Moves and / or resizes inner contour `index` (B52, D-092): x, y = new lower-left corner of its
 * box in the part frame, width / height = new box size. The contour keeps its shape (arcs scale
 * uniformly) and must still lie inside the part, clear of the other cut-outs.
 */
export const updateInnerContour = defineCommand({
  name: 'updateInnerContour',
  area: 'part',
  description:
    'Move or resize an inner contour (cut-out) of a part by index: x, y = lower-left corner of ' +
    'its box in the part frame (mm), width / height = box size. It must stay inside the part.',
  aiTool: false,
  params: innerBox,
  check: (project, p) => {
    const r = placedInner(project, p);
    return 'error' in r ? r.error : undefined;
  },
  apply: (draft, p) => {
    const r = placedInner(draft as Project, p);
    if ('error' in r) return;
    const part = draft.parts.find((x) => x.id === p.id);
    if (part) part.inners[p.index] = r.vertices;
  },
});
