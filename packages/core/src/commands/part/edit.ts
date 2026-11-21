/**
 * Properties-panel outline commands (T130, spec §4.4): segment length / angle and vertex
 * position. One undo step each; a parametric rectangle becomes a freeform part first ("serbest
 * şekle dönüştür"). The geometry lives in `editor/edit.ts`; a refused edit names its reason.
 * Board edits are UI commands, not AI tools.
 */
import type { Draft } from 'immer';
import { z } from 'zod';
import {
  withSegmentAngle,
  withSegmentLength,
  withSegmentSplit,
  withVertexAt,
  type OutlineEdit,
  type OutlineEditError,
} from '../../editor/edit';
import {
  deriveOutline,
  rectPartSchema,
  type FreeformPart,
  type Part,
  type Project,
  type RectPart,
  type Vertex,
} from '../../schema';
import { defineCommand } from '../types';
import { freezeBoard } from './board';

const ERRORS: Record<OutlineEditError, string> = {
  index: 'no such segment or vertex',
  length: 'the value must be a positive finite number',
  degenerate: 'the outline would have no area or turn inside out',
  crossing: 'the outline would cross itself',
};

const index = z.number().int({ error: 'index must be an integer' }).min(0);
const num = z.number({ error: 'must be a finite number' });

/** Replaces a part's outline; a rectangle becomes a freeform part (its fields are kept). */
export function setOutline(draft: Draft<Project>, id: string, outline: Vertex[]): void {
  const at = draft.parts.findIndex((p) => p.id === id);
  const part = draft.parts[at];
  if (!part) return;
  if (part.kind === 'freeform') {
    part.outline = outline;
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped rect-only fields
  const { params: _rect, outline: _cache, kind: _kind, ...rest } = part as RectPart;
  draft.parts[at] = { ...rest, kind: 'freeform', outline } as FreeformPart;
}

/** A command that replaces the outline with `edit(outline)` when the edit is valid. */
function outlineCommand<S extends z.ZodObject<{ id: typeof rectPartSchema.shape.id }>>(def: {
  name: string;
  description: string;
  params: S;
  edit: (outline: Vertex[], params: z.output<S>) => OutlineEdit;
}) {
  const run = (project: Project, params: z.output<S>): OutlineEdit | string => {
    const part = project.parts.find((p) => p.id === (params as { id: string }).id);
    if (!part) return `no part with id "${(params as { id: string }).id}"`;
    return def.edit(deriveOutline(part as Part), params);
  };
  return defineCommand({
    name: def.name,
    area: 'part',
    description: def.description,
    aiTool: false,
    params: def.params,
    check: (project, params) => {
      const r = run(project, params);
      if (typeof r === 'string') return r;
      return r.ok ? undefined : ERRORS[r.error];
    },
    apply: (draft, params) => {
      const r = run(draft as Project, params);
      if (typeof r === 'string' || !r.ok) return;
      freezeBoard(draft);
      setOutline(draft, (params as { id: string }).id, r.vertices);
    },
  });
}

/**
 * Sets the path length of one outline segment (vertex `index` → next). The end vertex slides
 * along the segment and the next segment follows (spec §4.4); no solver.
 */
export const setSegmentLength = outlineCommand({
  name: 'setSegmentLength',
  description:
    'Set the length (mm) of one outline segment: the end vertex moves along the segment and the ' +
    'next segment follows. keepRight: on an orthogonal shape the next edge slides along instead, ' +
    'so the right angles stay. Rectangles become freeform parts.',
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    index,
    length: num.positive({ error: 'length must be greater than 0' }),
    /** B52 (D-096): keep the right angles where the corners are right angles. */
    keepRight: z.boolean().optional(),
  }),
  edit: (vs, p) => withSegmentLength(vs, p.index, p.length, p.keepRight ?? false),
});

/** Turns one outline segment about its start vertex to `angle` degrees (CCW from +X). */
export const setSegmentAngle = outlineCommand({
  name: 'setSegmentAngle',
  description:
    'Set the direction (degrees, CCW from +X) of one outline segment, turning it about its start ' +
    'vertex; its length stays and the next segment follows.',
  params: z.strictObject({ id: rectPartSchema.shape.id, index, angle: num }),
  edit: (vs, p) => withSegmentAngle(vs, p.index, p.angle),
});

/** Moves one outline vertex to x, y in the part frame; both neighbouring segments follow. */
export const moveVertex = outlineCommand({
  name: 'moveVertex',
  description:
    'Move one outline vertex to x, y (mm, part frame); both neighbouring segments follow. ' +
    'Rectangles become freeform parts.',
  params: z.strictObject({ id: rectPartSchema.shape.id, index, x: num, y: num }),
  edit: (vs, p) => withVertexAt(vs, p.index, { x: p.x, y: p.y }),
});

/** Splits one outline segment at its middle (B50): a new corner to move; the shape stays. */
export const splitSegment = outlineCommand({
  name: 'splitSegment',
  description:
    'Add a corner in the middle of one outline segment (index), so it can be moved to make an L ' +
    'or a notch. The shape does not change. Rectangles become freeform parts.',
  params: z.strictObject({ id: rectPartSchema.shape.id, index }),
  edit: (vs, p) => withSegmentSplit(vs, p.index),
});
