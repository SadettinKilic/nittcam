/** Part commands (spec §5.1 "Parça"). */
import { z } from 'zod';
import { edgeBandSchema, rectParamsSchema, rectPartSchema } from '../../schema';
import { defineCommand } from '../types';

const noBand = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Adds a parametric rectangle part at the end of the part list. The caller supplies the id
 * (core is pure: no random ids). Holes, inners and templates start empty; later commands add them.
 */
export const addPart = defineCommand({
  name: 'addPart',
  area: 'part',
  description:
    'Add a rectangular part. Sizes in millimetres: w along X, h along Y, r = corner radius ' +
    '(0 = sharp, at most half the shorter side). grainLock keeps the part aligned with the sheet grain.',
  aiTool: true,
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    name: rectPartSchema.shape.name.default(''),
    qty: rectPartSchema.shape.qty.default(1),
    grainLock: rectPartSchema.shape.grainLock.default(false),
    params: rectParamsSchema,
    edgeBand: edgeBandSchema.default(noBand),
  }),
  check: (project, params) =>
    project.parts.some((p) => p.id === params.id)
      ? `a part with id "${params.id}" already exists`
      : undefined,
  apply: (draft, params) => {
    draft.parts.push({
      id: params.id,
      name: params.name,
      qty: params.qty,
      grainLock: params.grainLock,
      kind: 'rect',
      params: { w: params.params.w, h: params.params.h, r: params.params.r },
      inners: [],
      holes: [],
      edgeBand: { ...params.edgeBand },
      templates: [],
    });
  },
});
