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
