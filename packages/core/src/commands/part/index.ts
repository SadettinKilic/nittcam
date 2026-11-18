/** Part commands (spec §5.1 "Parça", §4.1 cut list). */
import type { Draft } from 'immer';
import { z } from 'zod';
import {
  edgeBandSchema,
  partGrainSchema,
  rectParamsSchema,
  rectPartSchema,
  type PartGrain,
  type Project,
} from '../../schema';
import { defineCommand } from '../types';

const noBand = { top: 0, right: 0, bottom: 0, left: 0 };

const partIdSchema = rectPartSchema.shape.id;

/** Fields of a new rectangle part, as `addPart` and each `importCutList` row take them. */
const rectPartInput = {
  id: partIdSchema,
  name: rectPartSchema.shape.name.default(''),
  qty: rectPartSchema.shape.qty.default(1),
  /** Optional workshop note (T118); empty = none. */
  note: rectPartSchema.shape.note,
  /** Grain of the part (D-034); default free. */
  grain: partGrainSchema.optional(),
  /** Alias kept for one release: `true` = fixed along the sheet grain, `false` = free. */
  grainLock: z.boolean({ error: 'must be true or false' }).optional(),
  params: rectParamsSchema,
  edgeBand: edgeBandSchema.default(noBand),
};

const rectPartInputSchema = z.strictObject(rectPartInput);
type RectPartInput = z.output<typeof rectPartInputSchema>;

/**
 * The part grain for the `grainLock` alias (D-034): locked = fixed along the sheet grain (the v1
 * meaning, same as the v1 → v2 migration; 0 when the sheet has no grain), unlocked = free.
 */
export function grainFromLock(grainLock: boolean, sheetGrain: number | null): PartGrain {
  return grainLock ? { mode: 'fixed', angle: sheetGrain ?? 0 } : { mode: 'free', angle: 0 };
}

function pushRectPart(draft: Draft<Project>, p: RectPartInput): void {
  const grain = p.grain ?? grainFromLock(p.grainLock ?? false, draft.stock.sheet.grain);
  draft.parts.push({
    id: p.id,
    name: p.name,
    qty: p.qty,
    ...(p.note ? { note: p.note } : {}),
    grain: { mode: grain.mode, angle: grain.angle },
    kind: 'rect',
    params: { w: p.params.w, h: p.params.h, r: p.params.r },
    inners: [],
    holes: [],
    edgeBand: { ...p.edgeBand },
    templates: [],
  });
}

function hasPart(project: Project, id: string): boolean {
  return project.parts.some((p) => p.id === id);
}

/**
 * Drops layout placements that no longer point at an existing part copy (after a part is
 * removed or its quantity lowered). The layout is derived data (spec §9.2) and the next nesting
 * run fills it again. A sheet's array is only replaced when something is dropped.
 */
function dropStalePlacements(draft: Draft<Project>): void {
  const qty = new Map(draft.parts.map((p) => [p.id, p.qty]));
  for (const sheet of draft.layout.sheets) {
    const keep = sheet.placements.filter((pl) => pl.index < (qty.get(pl.partId) ?? 0));
    if (keep.length !== sheet.placements.length) sheet.placements = keep;
  }
}

/**
 * Adds a parametric rectangle part at the end of the part list. The caller supplies the id
 * (core is pure: no random ids). Holes, inners and templates start empty; later commands add them.
 */
export const addPart = defineCommand({
  name: 'addPart',
  area: 'part',
  description:
    'Add a rectangular part. Sizes in millimetres: w along X, h along Y, r = corner radius ' +
    '(0 = sharp, at most half the shorter side). grain = { mode: "fixed" | "free", angle in degrees ' +
    '[0, 180) in the part frame }: a fixed part is always placed with its grain along the sheet ' +
    'grain. grainLock: true is a shorthand for fixed along the sheet grain.',
  aiTool: true,
  params: rectPartInputSchema,
  check: (project, params) =>
    hasPart(project, params.id) ? `a part with id "${params.id}" already exists` : undefined,
  apply: (draft, params) => {
    pushRectPart(draft, params);
  },
});

/** Most rows one import may carry (a guard against pasting a whole workbook by mistake). */
export const MAX_IMPORT_ROWS = 2000;

/**
 * Adds many rectangle parts in one undoable step (cut-list paste, spec §4.1). Rows arrive
 * already parsed and confirmed by the user (see `parseCutList`); ids come from the caller.
 */
export const importCutList = defineCommand({
  name: 'importCutList',
  area: 'part',
  description:
    'Add several rectangular parts at once from a confirmed cut list. Each row is like addPart: ' +
    'sizes in millimetres (w along X, h along Y), qty >= 1, optional grain (or grainLock) and edge band per ' +
    'edge. Never convert units on your own; ask the user when mm or cm is unclear.',
  aiTool: true,
  params: z.strictObject({
    parts: z
      .array(rectPartInputSchema)
      .min(1, { error: 'the cut list must contain at least one part' })
      .max(MAX_IMPORT_ROWS, { error: `at most ${MAX_IMPORT_ROWS} parts per import` }),
  }),
  check: (project, params) => {
    const seen = new Set<string>();
    for (const p of params.parts) {
      if (seen.has(p.id)) return `part id "${p.id}" appears twice in the cut list`;
      if (hasPart(project, p.id)) return `a part with id "${p.id}" already exists`;
      seen.add(p.id);
    }
    return undefined;
  },
  apply: (draft, params) => {
    for (const p of params.parts) pushRectPart(draft, p);
  },
});

/**
 * Changes fields of an existing part. Only the given fields change; `params` and `edgeBand`
 * may be partial. Sizes apply to rectangle parts only (r ≤ min(w, h) / 2 is checked on the
 * result). Lowering `qty` drops layout placements of copies that no longer exist.
 */
export const updatePart = defineCommand({
  name: 'updatePart',
  area: 'part',
  description:
    'Change an existing part by id. Give only the fields to change: name, qty, note, grain ' +
    '({ mode: "fixed" | "free", angle 0–180° in the part frame }; grainLock is an old alias), ' +
    'params (w, h, r in millimetres; rectangle parts only) and edgeBand (top, right, bottom, ' +
    'left in millimetres).',
  aiTool: true,
  params: z
    .strictObject({
      id: partIdSchema,
      name: rectPartSchema.shape.name.optional(),
      qty: rectPartSchema.shape.qty.optional(),
      /** Workshop note; '' removes it. */
      note: rectPartSchema.shape.note,
      grain: partGrainSchema.optional(),
      /** Alias kept for one release (D-034): `true` = fixed along the sheet grain, `false` = free. */
      grainLock: z.boolean({ error: 'must be true or false' }).optional(),
      params: z
        .strictObject({
          w: rectParamsSchema.shape.w.optional(),
          h: rectParamsSchema.shape.h.optional(),
          r: rectParamsSchema.shape.r.optional(),
        })
        .optional(),
      edgeBand: edgeBandSchema.partial().optional(),
    })
    .refine(
      (p) =>
        p.name !== undefined ||
        p.qty !== undefined ||
        p.note !== undefined ||
        p.grain !== undefined ||
        p.grainLock !== undefined ||
        p.params !== undefined ||
        p.edgeBand !== undefined,
      { error: 'give at least one field to change' },
    ),
  check: (project, params) => {
    const part = project.parts.find((p) => p.id === params.id);
    if (!part) return `no part with id "${params.id}"`;
    if (params.params !== undefined && part.kind !== 'rect') {
      return `part "${params.id}" is not a rectangle; its size comes from its outline`;
    }
    return undefined;
  },
  apply: (draft, params) => {
    const part = draft.parts.find((p) => p.id === params.id);
    if (!part) return;
    if (params.name !== undefined) part.name = params.name;
    if (params.qty !== undefined) part.qty = params.qty;
    if (params.note !== undefined) {
      if (params.note === '') delete part.note;
      else part.note = params.note;
    }
    if (params.grain !== undefined) {
      part.grain = { mode: params.grain.mode, angle: params.grain.angle };
    } else if (params.grainLock !== undefined) {
      part.grain = grainFromLock(params.grainLock, draft.stock.sheet.grain);
    }
    if (params.params !== undefined && part.kind === 'rect') {
      const { w, h, r } = params.params;
      if (w !== undefined) part.params.w = w;
      if (h !== undefined) part.params.h = h;
      if (r !== undefined) part.params.r = r;
      // The outline is only a cache of params (D-010); drop it so it can never go stale.
      if ((w !== undefined || h !== undefined || r !== undefined) && part.outline !== undefined) {
        delete part.outline;
      }
    }
    if (params.edgeBand !== undefined) {
      const band = params.edgeBand;
      if (band.top !== undefined) part.edgeBand.top = band.top;
      if (band.right !== undefined) part.edgeBand.right = band.right;
      if (band.bottom !== undefined) part.edgeBand.bottom = band.bottom;
      if (band.left !== undefined) part.edgeBand.left = band.left;
    }
    if (params.qty !== undefined) dropStalePlacements(draft);
  },
});

/**
 * Sets a part's grain (D-034): `fixed` keeps the grain line at `angle` (part frame, degrees in
 * [0, 180)) along the sheet grain in nesting; `free` lets the part turn by quarter turns.
 */
export const setPartGrain = defineCommand({
  name: 'setPartGrain',
  area: 'part',
  description:
    'Set the grain of a part by id: mode "fixed" (the part is always placed with its grain along ' +
    'the sheet grain) or "free", and the grain angle in degrees [0, 180) in the part frame ' +
    '(0 = along the part X axis).',
  aiTool: true,
  params: z.strictObject({
    id: partIdSchema,
    mode: partGrainSchema.shape.mode,
    angle: partGrainSchema.shape.angle,
  }),
  check: (project, params) =>
    hasPart(project, params.id) ? undefined : `no part with id "${params.id}"`,
  apply: (draft, params) => {
    const part = draft.parts.find((p) => p.id === params.id);
    if (!part) return;
    if (part.grain.mode !== params.mode) part.grain.mode = params.mode;
    if (part.grain.angle !== params.angle) part.grain.angle = params.angle;
  },
});

/** Removes a part and every layout placement of it. */
export const removePart = defineCommand({
  name: 'removePart',
  area: 'part',
  description: 'Remove a part by id (its placements in the layout are removed too).',
  aiTool: true,
  params: z.strictObject({ id: partIdSchema }),
  check: (project, params) =>
    hasPart(project, params.id) ? undefined : `no part with id "${params.id}"`,
  apply: (draft, params) => {
    const index = draft.parts.findIndex((p) => p.id === params.id);
    if (index < 0) return;
    draft.parts.splice(index, 1);
    dropStalePlacements(draft);
  },
});

/**
 * Copies a part (geometry, holes, edge band, templates) under a new caller-supplied id and
 * inserts the copy right after the original. The copy is not placed in the layout.
 */
export const duplicatePart = defineCommand({
  name: 'duplicatePart',
  area: 'part',
  description:
    'Copy an existing part under a new id; the copy is inserted right after the original. ' +
    'Optionally give the copy a new name.',
  aiTool: true,
  params: z.strictObject({
    id: partIdSchema,
    newId: partIdSchema,
    name: rectPartSchema.shape.name.optional(),
  }),
  check: (project, params) => {
    if (!hasPart(project, params.id)) return `no part with id "${params.id}"`;
    if (hasPart(project, params.newId)) return `a part with id "${params.newId}" already exists`;
    return undefined;
  },
  apply: (draft, params) => {
    const index = draft.parts.findIndex((p) => p.id === params.id);
    const source = draft.parts[index];
    if (!source) return;
    // Plain JSON data (schema-valid project), so a JSON copy is a deep copy.
    const copy = JSON.parse(JSON.stringify(source)) as typeof source;
    copy.id = params.newId;
    if (params.name !== undefined) copy.name = params.name;
    draft.parts.splice(index + 1, 0, copy);
  },
});

export { mirrorPart, movePart, pasteParts, removeParts, rotatePart, setPartsGrain } from './board';
export { drawPart, setSegmentBulge } from './draw';
