/**
 * Dimension commands (T133, spec §4.4 "ölçü"): persistent linear dimensions on a part. They are
 * annotations in the part frame; nesting, toolpath and export never read them. One undo step each.
 * Board edits are UI commands, not AI tools.
 */
import { z } from 'zod';
import { EPS } from '../../geometry/constants';
import { boardPositions } from '../../editor/board';
import { dimensionLineSchema, rectPartSchema, type Project } from '../../schema';
import { defineCommand } from '../types';
import { freezeBoard } from './board';

const point = dimensionLineSchema.shape.a;

/**
 * Adds a linear dimension between two board points (mm) to a part. The points are stored in the
 * part frame, so the dimension moves, turns and flips with the part.
 */
export const addDimension = defineCommand({
  name: 'addDimension',
  area: 'part',
  description:
    'Add a linear dimension (a non-cut annotation) to a part between two board points a and b ' +
    'in mm. Nesting, toolpath and export ignore it.',
  aiTool: false,
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    dimId: dimensionLineSchema.shape.id,
    a: point,
    b: point,
  }),
  check: (project, params) => {
    const part = project.parts.find((p) => p.id === params.id);
    if (!part) return `no part with id "${params.id}"`;
    if (part.dims?.some((d) => d.id === params.dimId)) {
      return `dimension "${params.dimId}" already exists`;
    }
    if ((part.dims?.length ?? 0) >= 200) return 'at most 200 dimensions per part';
    if (Math.hypot(params.b.x - params.a.x, params.b.y - params.a.y) < EPS) {
      return 'the two points of a dimension must differ';
    }
    return undefined;
  },
  apply: (draft, params) => {
    const at = boardPositions(draft as Project).get(params.id);
    freezeBoard(draft);
    const part = draft.parts.find((p) => p.id === params.id);
    if (!part || !at) return;
    const local = (p: { x: number; y: number }) => ({ x: p.x - at.x, y: p.y - at.y });
    part.dims = [
      ...(part.dims ?? []),
      { id: params.dimId, a: local(params.a), b: local(params.b) },
    ];
  },
});

/** Removes one dimension of a part. */
export const removeDimension = defineCommand({
  name: 'removeDimension',
  area: 'part',
  description: 'Remove a linear dimension (annotation) from a part.',
  aiTool: false,
  params: z.strictObject({ id: rectPartSchema.shape.id, dimId: dimensionLineSchema.shape.id }),
  check: (project, params) => {
    const part = project.parts.find((p) => p.id === params.id);
    if (!part) return `no part with id "${params.id}"`;
    return part.dims?.some((d) => d.id === params.dimId)
      ? undefined
      : `no dimension "${params.dimId}" on part "${params.id}"`;
  },
  apply: (draft, params) => {
    const part = draft.parts.find((p) => p.id === params.id);
    if (!part?.dims) return;
    const rest = part.dims.filter((d) => d.id !== params.dimId);
    if (rest.length > 0) part.dims = rest;
    else delete part.dims;
  },
});
