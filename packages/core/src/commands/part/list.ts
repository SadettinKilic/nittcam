/**
 * Cut-list row commands (T119, spec §4.1): bulk edit, duplicate and reorder several rows in one
 * undo step each. Removing several rows is `removeParts` (board.ts).
 */
import type { Draft } from 'immer';
import { z } from 'zod';
import { edgeBandSchema, partGrainSchema, rectPartSchema, type Project } from '../../schema';
import { defineCommand } from '../types';

const partId = rectPartSchema.shape.id;

const idList = z
  .array(partId)
  .min(1, { error: 'give at least one part id' })
  .max(2000, { error: 'at most 2000 parts at once' });

function missing(project: Project, ids: readonly string[]): string | undefined {
  const have = new Set(project.parts.map((p) => p.id));
  const gone = ids.find((id) => !have.has(id));
  if (gone !== undefined) return `no part with id "${gone}"`;
  if (new Set(ids).size !== ids.length) return 'a part id appears twice';
  return undefined;
}

/** Drops placements of copies that no longer exist after a quantity went down. */
function dropStalePlacements(draft: Draft<Project>): void {
  const qty = new Map(draft.parts.map((p) => [p.id, p.qty]));
  for (const sheet of draft.layout.sheets) {
    const keep = sheet.placements.filter((pl) => pl.index < (qty.get(pl.partId) ?? 0));
    if (keep.length !== sheet.placements.length) sheet.placements = keep;
  }
}

/**
 * Bulk edit of the selected rows (T119): the same quantity, grain, edge bands (per edge; only
 * the given edges change) and/or a name prefix on every part, in one undo step.
 */
export const updateParts = defineCommand({
  name: 'updateParts',
  area: 'part',
  description:
    'Change several parts by id in one step: qty, grain ({ mode, angle }), edgeBand (only the ' +
    'given edges, millimetres), namePrefix (text put in front of every name) and group (a label; ' +
    '"" removes it).',
  aiTool: true,
  params: z
    .strictObject({
      ids: idList,
      qty: rectPartSchema.shape.qty.optional(),
      grain: partGrainSchema.optional(),
      edgeBand: edgeBandSchema.partial().optional(),
      namePrefix: z.string().min(1).max(60).optional(),
      /** Group label (T123 bulk edit); '' removes it. */
      group: z.string().trim().max(60).optional(),
    })
    .refine(
      (p) =>
        p.qty !== undefined ||
        p.grain !== undefined ||
        (p.edgeBand !== undefined && Object.keys(p.edgeBand).length > 0) ||
        p.namePrefix !== undefined ||
        p.group !== undefined,
      { error: 'give at least one field to change' },
    ),
  check: (project, params) => missing(project, params.ids),
  apply: (draft, params) => {
    const ids = new Set(params.ids);
    for (const part of draft.parts) {
      if (!ids.has(part.id)) continue;
      if (params.qty !== undefined && part.qty !== params.qty) part.qty = params.qty;
      if (params.grain !== undefined) {
        if (part.grain.mode !== params.grain.mode) part.grain.mode = params.grain.mode;
        if (part.grain.angle !== params.grain.angle) part.grain.angle = params.grain.angle;
      }
      const band = params.edgeBand;
      if (band !== undefined) {
        for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
          const v = band[edge];
          if (v !== undefined && part.edgeBand[edge] !== v) part.edgeBand[edge] = v;
        }
      }
      if (params.namePrefix !== undefined) part.name = `${params.namePrefix}${part.name}`;
      if (params.group !== undefined) {
        if (params.group === '') delete part.group;
        else if (part.group !== params.group) part.group = params.group;
      }
    }
    if (params.qty !== undefined) dropStalePlacements(draft);
  },
});

/**
 * Duplicates several rows in one step (T119 Ctrl+D): each copy (new caller-supplied id) is
 * inserted right after its original. Copies are not placed in the layout.
 */
export const duplicateParts = defineCommand({
  name: 'duplicateParts',
  area: 'part',
  description: 'Copy several parts in one step; each copy goes right after its original.',
  aiTool: false,
  params: z
    .strictObject({ ids: idList, newIds: idList })
    .refine((p) => p.ids.length === p.newIds.length, {
      error: 'give one new id per part',
      path: ['newIds'],
    }),
  check: (project, params) => {
    const bad = missing(project, params.ids);
    if (bad) return bad;
    const taken = new Set(project.parts.map((p) => p.id));
    for (const id of params.newIds) {
      if (taken.has(id)) return `a part with id "${id}" already exists`;
      taken.add(id);
    }
    return undefined;
  },
  apply: (draft, params) => {
    const newId = new Map(params.ids.map((id, i) => [id, params.newIds[i] as string]));
    // Walk backwards so inserting a copy never shifts an original that is still to come.
    for (let i = draft.parts.length - 1; i >= 0; i--) {
      const source = draft.parts[i];
      const id = source ? newId.get(source.id) : undefined;
      if (!source || id === undefined) continue;
      // Plain JSON data (schema-valid project), so a JSON copy is a deep copy.
      const copy = JSON.parse(JSON.stringify(source)) as typeof source;
      copy.id = id;
      draft.parts.splice(i + 1, 0, copy);
    }
  },
});

/**
 * Moves the selected rows one place up or down in the list (T119 row menu). The selection moves
 * as a block past its neighbour; rows already at the edge stay. View order only matters for the
 * cut list and labels; nesting does not depend on it.
 */
export const reorderParts = defineCommand({
  name: 'reorderParts',
  area: 'part',
  description: 'Move parts one place up or down in the cut list.',
  aiTool: false,
  params: z.strictObject({ ids: idList, direction: z.enum(['up', 'down']) }),
  check: (project, params) => missing(project, params.ids),
  apply: (draft, params) => {
    const ids = new Set(params.ids);
    const parts = draft.parts;
    if (params.direction === 'up') {
      for (let i = 1; i < parts.length; i++) {
        const cur = parts[i];
        const prev = parts[i - 1];
        if (cur && prev && ids.has(cur.id) && !ids.has(prev.id)) {
          parts.splice(i - 1, 2, cur, prev);
        }
      }
    } else {
      for (let i = parts.length - 2; i >= 0; i--) {
        const cur = parts[i];
        const next = parts[i + 1];
        if (cur && next && ids.has(cur.id) && !ids.has(next.id)) {
          parts.splice(i, 2, next, cur);
        }
      }
    }
  },
});
