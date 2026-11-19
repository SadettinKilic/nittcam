/**
 * `importDxf` (T145, spec §4.6, §5.1): the parts confirmed in the DXF import dialog arrive as
 * freeform parts in one undo step. Geometry comes from the file (never from AI), so this is a UI
 * command, not an AI tool.
 */
import { z } from 'zod';
import { BOARD_GAP, boardBox, boardParts } from '../../editor/board';
import { placeOutline, tidy } from '../../editor/draw';
import { normalizeInner } from '../../editor/inners';
import { bbox, contour } from '../../geometry/polyline';
import { contourSchema, rectPartSchema, type FreeformPart, type Project } from '../../schema';
import { defineCommand } from '../types';
import { freezeBoard } from './board';

/** Most parts one DXF import may add. */
export const MAX_DXF_PARTS = 500;

const coord = z.number({ error: 'must be a finite number (mm)' });

const dxfPartSchema = z.strictObject({
  id: rectPartSchema.shape.id,
  name: rectPartSchema.shape.name.default(''),
  /** Outline in drawing millimetres (any direction; stored CCW). */
  outline: contourSchema,
  /** Inner contours in drawing millimetres (stored CW). */
  inners: z.array(contourSchema).default([]),
});

export const importDxfParamsSchema = z.strictObject({
  /**
   * Board position of the drawing's lower-left corner. Default: right of the parts already on
   * the board (BOARD_GAP apart), or the origin on an empty board.
   */
  at: z.strictObject({ x: coord, y: coord }).optional(),
  parts: z
    .array(dxfPartSchema)
    .min(1, { error: 'the DXF import must contain at least one part' })
    .max(MAX_DXF_PARTS, { error: `at most ${MAX_DXF_PARTS} parts per DXF import` }),
});

/** Where the drawing's lower-left corner goes on the board by default. */
export function dxfImportOrigin(project: Project): { x: number; y: number } {
  const box = boardBox(boardParts(project));
  return box ? { x: tidy(box.maxX + BOARD_GAP), y: tidy(box.minY) } : { x: 0, y: 0 };
}

export const importDxf = defineCommand({
  name: 'importDxf',
  area: 'part',
  description:
    'Add the parts recognised in a DXF file (outline and inner contours in millimetres) as ' +
    'freeform parts in one step. UI only: the geometry comes from the file.',
  aiTool: false,
  params: importDxfParamsSchema,
  check: (project, params) => {
    const seen = new Set<string>();
    for (const p of params.parts) {
      if (seen.has(p.id)) return `part id "${p.id}" appears twice in the DXF import`;
      if (project.parts.some((x) => x.id === p.id)) return `a part with id "${p.id}" already exists`;
      seen.add(p.id);
    }
    return undefined;
  },
  apply: (draft, params) => {
    const origin = params.at ?? dxfImportOrigin(draft as Project);
    freezeBoard(draft);
    let minX = Infinity;
    let minY = Infinity;
    for (const p of params.parts) {
      const b = bbox(contour(p.outline));
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
    }
    for (const p of params.parts) {
      const placed = placeOutline(p.outline);
      const part: FreeformPart = {
        id: p.id,
        name: p.name,
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'freeform',
        outline: placed.outline,
        inners: p.inners.map((inner) =>
          normalizeInner(
            inner.map((v) => ({ x: tidy(v.x - placed.at.x), y: tidy(v.y - placed.at.y), bulge: v.bulge })),
          ),
        ),
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
        draw: { x: tidy(origin.x + placed.at.x - minX), y: tidy(origin.y + placed.at.y - minY) },
      };
      draft.parts.push(part);
    }
  },
});
