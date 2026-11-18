/**
 * Drawing-tool commands (T127–T129, spec §4.3, §4.4): a finished rectangle, circle or closed
 * polyline becomes one part in one undo step. Board drawing is a UI command, not an AI tool.
 */
import { z } from 'zod';
import { placeOutline, tidy } from '../../editor/draw';
import { contour, normalize, orientation } from '../../geometry/polyline';
import {
  contourSchema,
  rectParamsSchema,
  deriveOutline,
  rectPartSchema,
  type FreeformPart,
  type Part,
  type Project,
  type RectPart,
} from '../../schema';
import { defineCommand } from '../types';
import { freezeBoard } from './board';

/** Largest bulge a bend may set (a 3° gap short of a full circle on one segment). */
export const MAX_BULGE = 50;

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

/**
 * Bends one outline segment into an arc (T129, spec §4.4 "çizgiye eğim verme"): segment `index`
 * runs from outline vertex `index` to the next one; `bulge` = tan(θ/4), 0 = straight again. A
 * parametric rectangle becomes a freeform part first ("serbest şekle dönüştür"); the outline is
 * re-normalised CCW. The board position stays.
 */
export const setSegmentBulge = defineCommand({
  name: 'setSegmentBulge',
  area: 'part',
  description:
    'Bend one segment of a part outline into an arc: bulge = tan(sweep/4) of the arc from vertex ' +
    'index to the next vertex (0 = straight line). Rectangles become freeform parts.',
  aiTool: false,
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    index: z.number().int({ error: 'segment index must be an integer' }).min(0),
    bulge: z
      .number({ error: 'bulge must be a finite number' })
      .min(-MAX_BULGE, { error: `bulge must be between -${MAX_BULGE} and ${MAX_BULGE}` })
      .max(MAX_BULGE, { error: `bulge must be between -${MAX_BULGE} and ${MAX_BULGE}` }),
  }),
  check: (project, params) => {
    const part = project.parts.find((p) => p.id === params.id);
    if (!part) return `no part with id "${params.id}"`;
    const n = deriveOutline(part).length;
    if (params.index >= n) return `segment index ${params.index} is out of range (0–${n - 1})`;
    const vs = deriveOutline(part).map((v, i) =>
      i === params.index ? { ...v, bulge: params.bulge } : v,
    );
    if (orientation(contour(vs)) === 'none') return 'the bent outline has no area';
    return undefined;
  },
  apply: (draft, params) => {
    freezeBoard(draft);
    const at = draft.parts.findIndex((p) => p.id === params.id);
    const part = draft.parts[at];
    if (!part) return;
    const vs = deriveOutline(part as Part).map((v, i) =>
      i === params.index ? { x: v.x, y: v.y, bulge: params.bulge } : { ...v },
    );
    const outline = normalize(contour(vs), 'outer').vertices;
    if (part.kind === 'freeform') {
      part.outline = outline;
      return;
    }
    // Rectangle → freeform: same fields, the outline is now the source.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped rect-only fields
    const { params: _rect, outline: _cache, kind: _kind, ...rest } = part as RectPart;
    draft.parts[at] = { ...rest, kind: 'freeform', outline } as FreeformPart;
  },
});
