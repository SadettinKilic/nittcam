/**
 * Drawing-tool commands (T127–T129, spec §4.3, §4.4): a finished rectangle, circle or closed
 * polyline becomes one part in one undo step. Board drawing is a UI command, not an AI tool.
 */
import { z } from 'zod';
import { placeOutline, tidy } from '../../editor/draw';
import {
  contourSchema,
  rectParamsSchema,
  rectPartSchema,
  type Part,
  type Project,
} from '../../schema';
import { defineCommand } from '../types';
import { freezeBoard } from './board';

const coord = z.number({ error: 'must be a finite number (mm)' });

const shapeSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('rect'), params: rectParamsSchema }),
    z.strictObject({ kind: z.literal('outline'), vertices: contourSchema }),
  ],
  { error: 'shape kind is "rect" or "outline"' },
);

function noPart(project: Project, id: string): string | undefined {
  return project.parts.some((p) => p.id === id)
    ? `a part with id "${id}" already exists`
    : undefined;
}

/**
 * Adds a drawn part at a board position: a parametric rectangle (`rect`) or a freeform part from a
 * closed contour (`outline`, board coordinates; it is normalised CCW and moved into a local frame
 * at its bounding box corner).
 */
export const drawPart = defineCommand({
  name: 'drawPart',
  area: 'part',
  description:
    'Add a part drawn on the board: a rectangle (params w, h, r with its lower-left corner at ' +
    '"at") or a closed outline in board millimetres (becomes a freeform part).',
  aiTool: false,
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    name: rectPartSchema.shape.name.default(''),
    at: z.strictObject({ x: coord, y: coord }).default({ x: 0, y: 0 }),
    shape: shapeSchema,
  }),
  check: (project, params) => noPart(project, params.id),
  apply: (draft, params) => {
    freezeBoard(draft);
    const base = {
      id: params.id,
      name: params.name,
      qty: 1,
      grainLock: false,
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    };
    let part: Part;
    if (params.shape.kind === 'rect') {
      const { w, h, r } = params.shape.params;
      part = { ...base, kind: 'rect', params: { w, h, r }, draw: { ...params.at } };
    } else {
      const placed = placeOutline(params.shape.vertices);
      part = {
        ...base,
        kind: 'freeform',
        outline: placed.outline,
        draw: { x: tidy(params.at.x + placed.at.x), y: tidy(params.at.y + placed.at.y) },
      };
    }
    draft.parts.push(part);
  },
});
