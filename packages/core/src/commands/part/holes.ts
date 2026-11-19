/**
 * Hole commands (T138, spec §4.5, §5.1 "Delik ve işlem"): add, change and remove a hole of a part.
 * Coordinates are in the part frame (bottom-left origin), so holes turn and flip with the part
 * (`rotatePart`, `mirrorPart`, nesting rotation). One undo step each. The hole must lie inside
 * the part and clear of its cut-outs; the tool rules (d ≥ tool, groove width, blind depth <
 * thickness) need the machine profile and stay validation issues (`validate`).
 */
import { z } from 'zod';
import { checkHolePlacement, type HolePlacementError } from '../../editor/holes';
import { deriveOutline, holeSchema, rectPartSchema, type Hole, type Project } from '../../schema';
import { defineCommand } from '../types';

const PLACEMENT_ERRORS: Record<HolePlacementError, string> = {
  outside: 'the hole must lie inside the part outline (its whole circle)',
  cutout: 'the hole must not touch or overlap an inner contour (cut-out)',
};

const partId = rectPartSchema.shape.id;
const holeId = z.string({ error: 'must be a string' }).min(1, { error: 'must not be empty' });

/** Why `hole` cannot sit in part `id` (undefined = it can). `skip` = the hole being replaced. */
function placementProblem(project: Project, id: string, hole: Hole, skip?: string) {
  const part = project.parts.find((p) => p.id === id);
  if (!part) return `no part with id "${id}"`;
  if (part.holes.some((h) => h.id === hole.id && h.id !== skip)) {
    return `part "${id}" already has a hole with id "${hole.id}"`;
  }
  const err = checkHolePlacement(deriveOutline(part), part.inners, hole);
  return err ? PLACEMENT_ERRORS[err] : undefined;
}

/** Adds a hole (pocket, through or groove) to a part. */
export const addHole = defineCommand({
  name: 'addHole',
  area: 'part',
  description:
    'Add a hole to a part. type "pocket" = blind, cleared to depth (e.g. a 35 mm hinge cup); ' +
    '"through" = cleared through the stock; "groove" = ring groove along the circle of ' +
    'centreline diameter d, grooveWidth wide, depth deep. cx/cy = centre in the part frame (mm, ' +
    'from the bottom-left corner). The hole must lie inside the part. tool = tool number.',
  aiTool: true,
  params: z.strictObject({ id: partId, hole: holeSchema }),
  check: (project, p) => placementProblem(project, p.id, p.hole),
  apply: (draft, p) => {
    draft.parts.find((x) => x.id === p.id)?.holes.push(p.hole);
  },
});

/**
 * Field changes of a hole. `type` may change ("İçini boşalt" ↔ "Sadece çember (kanal)"); the
 * result must be a complete hole of its type (a groove needs depth and grooveWidth, a pocket a
 * depth; fields the new type does not have are dropped).
 */
const holePatch = z.strictObject({
  type: z.enum(['pocket', 'through', 'groove']).optional(),
  d: z.number().optional(),
  cx: z.number().optional(),
  cy: z.number().optional(),
  depth: z.number().optional(),
  grooveWidth: z.number().optional(),
  tool: z.number().optional(),
});

/** The hole after `patch`, or an English message. */
function patched(
  project: Project,
  id: string,
  holeIdValue: string,
  patch: z.output<typeof holePatch>,
): Hole | string {
  const part = project.parts.find((p) => p.id === id);
  if (!part) return `no part with id "${id}"`;
  const old = part.holes.find((h) => h.id === holeIdValue);
  if (!old) return `part "${id}" has no hole "${holeIdValue}"`;
  const merged: Record<string, unknown> = { ...old };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v;
  const type = merged.type;
  if (type === 'through') {
    delete merged.depth;
    delete merged.grooveWidth;
  } else if (type === 'pocket') {
    delete merged.grooveWidth;
  }
  const parsed = holeSchema.safeParse(merged);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return `invalid hole: ${i ? `${i.path.join('.') || 'hole'} ${i.message}` : 'unknown problem'}`;
  }
  return parsed.data;
}

/** Changes fields of one hole (type, diameter, centre, depth, groove width, tool). */
export const updateHole = defineCommand({
  name: 'updateHole',
  area: 'part',
  description:
    'Change fields of a hole: type (pocket / through / groove), d, cx, cy, depth, grooveWidth, ' +
    'tool. The hole must still lie inside the part.',
  aiTool: true,
  params: z.strictObject({ id: partId, holeId, patch: holePatch }),
  check: (project, p) => {
    const h = patched(project, p.id, p.holeId, p.patch);
    if (typeof h === 'string') return h;
    return placementProblem(project, p.id, h, p.holeId);
  },
  apply: (draft, p) => {
    const h = patched(draft as Project, p.id, p.holeId, p.patch);
    if (typeof h === 'string') return;
    const part = draft.parts.find((x) => x.id === p.id);
    const at = part?.holes.findIndex((x) => x.id === p.holeId) ?? -1;
    if (part && at >= 0) part.holes[at] = h;
  },
});

/** Removes one hole of a part. */
export const removeHole = defineCommand({
  name: 'removeHole',
  area: 'part',
  description: 'Remove a hole of a part by its id.',
  aiTool: true,
  params: z.strictObject({ id: partId, holeId }),
  check: (project, p) => {
    const part = project.parts.find((x) => x.id === p.id);
    if (!part) return `no part with id "${p.id}"`;
    return part.holes.some((h) => h.id === p.holeId)
      ? undefined
      : `part "${p.id}" has no hole "${p.holeId}"`;
  },
  apply: (draft, p) => {
    const part = draft.parts.find((x) => x.id === p.id);
    const at = part?.holes.findIndex((h) => h.id === p.holeId) ?? -1;
    if (part && at >= 0) part.holes.splice(at, 1);
  },
});
