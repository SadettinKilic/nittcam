/** Nesting commands (spec §5.1 "Dizilim", §6.2, D-019). */
import { original, produceWithPatches, type Patch } from 'immer';
import { z } from 'zod';
import { PROFILE_BOUNDS } from '../../machine/profile';
import { allowedRotations, rotationAllowed, rotationPolicyOf } from '../../geometry/grain';
import { nestProject, type NestHooks } from '../../nesting/nest';
import { defaultSheet, nestingRotationSchema, nestingSchema, placementSchema, type Project } from '../../schema';
import { defineCommand } from '../types';

/** Sets the nesting goal, part gap and sheet margin. At least one field is required. */
export const setNestingOptions = defineCommand({
  name: 'setNestingOptions',
  area: 'nesting',
  description:
    'Set nesting options: mode ("minWaste", "fastest" or "minToolChanges"), the gap between parts in millimetres, the sheet edge margin in millimetres and the rotation policy of parts without grain ("free" = quarter turns, "none" = keep the drawn orientation, only 0°/180°). Pass only the fields to change.',
  aiTool: true,
  params: z
    .strictObject({
      mode: nestingSchema.shape.mode.optional(),
      gap: nestingSchema.shape.gap.optional(),
      margin: nestingSchema.shape.margin.optional(),
      rotation: nestingRotationSchema.optional(),
    })
    .refine(
      (p) =>
        p.mode !== undefined ||
        p.gap !== undefined ||
        p.margin !== undefined ||
        p.rotation !== undefined,
      { error: 'pass at least one of mode, gap, margin, rotation' },
    ),
  apply: (draft, params) => {
    if (params.mode !== undefined) draft.nesting.mode = params.mode;
    if (params.gap !== undefined) draft.nesting.gap = params.gap;
    if (params.margin !== undefined) draft.nesting.margin = params.margin;
    // Absent and "free" mean the same; only a real change records an undo step.
    if (params.rotation !== undefined && (draft.nesting.rotation ?? 'free') !== params.rotation) {
      draft.nesting.rotation = params.rotation;
    }
  },
});

/**
 * Sets the nesting goal (spec §6.2, T162): one objective, the modes are weight presets
 * (`MODE_WEIGHTS`): least waste, fastest production (shortest cutting + travel path) or fewest
 * tool changes. The next `runNesting` uses it.
 */
export const setNestingMode = defineCommand({
  name: 'setNestingMode',
  area: 'nesting',
  description:
    'Set the nesting goal: "minWaste" (least waste), "fastest" (shortest cutting and travel path) or "minToolChanges" (fewest tool changes). Run nesting afterwards to apply it.',
  aiTool: true,
  params: z.strictObject({ mode: nestingSchema.shape.mode }),
  apply: (draft, params) => {
    if (draft.nesting.mode !== params.mode) draft.nesting.mode = params.mode;
  },
});

export const runNestingParamsSchema = z.strictObject({
  /** Cutting tool diameter in mm; the caller takes it from the selected machine profile. */
  toolDiameter: z
    .number({ error: 'must be a number (mm)' })
    .positive({ error: 'must be a positive length in mm' })
    .max(PROFILE_BOUNDS.toolDiameter.max, {
      error: `must be at most ${PROFILE_BOUNDS.toolDiameter.max} mm`,
    }),
  /**
   * Tool number of the outer contours (the material set's tool) for the tool-change term (T162);
   * absent = a contour tool distinct from every hole tool.
   */
  contourTool: z
    .number({ error: 'must be a tool number' })
    .int({ error: 'must be an integer' })
    .positive({ error: 'must be a tool number >= 1' })
    .optional(),
});

/**
 * Runs the rectangle placer and writes `layout` (one undo step). Locked placements stay exactly
 * where they are (obstacles on their sheet); every other placement is recomputed. The placer is
 * deterministic, so replaying the log gives the same layout. The AI may run nesting but never
 * supplies placements: geometry comes from the engine (spec §5.4).
 */
export const runNesting = defineCommand({
  name: 'runNesting',
  area: 'nesting',
  description:
    'Run nesting: place all part copies on sheets with the current nesting options. Locked placements are kept. toolDiameter is the cutting tool diameter in millimetres from the machine profile; contourTool (optional) is its tool number.',
  aiTool: true,
  params: runNestingParamsSchema,
  apply: (draft, params) => {
    // Nothing is changed on the draft before this point, so the original is the current project.
    const project = original(draft) as Project;
    const layout = nestProject(project, {
      toolDiameter: params.toolDiameter,
      contourTool: params.contourTool,
    }).layout;
    setLayout(draft, project, layout);
  },
});

/**
 * Same layout as stored (a re-run without changes): leave the draft untouched, so the command
 * records no undo step.
 */
function setLayout(draft: Project, project: Project, layout: Project['layout']): void {
  if (JSON.stringify(layout) !== JSON.stringify(project.layout)) draft.layout = layout;
}

/** A `runNesting` computed off the main thread with progress (T163). */
export type RunNestingApplied =
  | {
      ok: true;
      project: Project;
      params: RunNestingParams;
      patches: Patch[];
      inversePatches: Patch[];
    }
  | { ok: false; error: string };

export type RunNestingParams = z.infer<typeof runNestingParamsSchema>;

/**
 * `runNesting` exactly as the command applies it, with a progress callback (T163; the Web Worker
 * reports it and can be terminated for "İptal"). Record the result with
 * `CommandStack.executeApplied('runNesting', …)`: the log holds the plain command, and replaying
 * it gives the same layout (the placer is deterministic). Pure apart from the callback.
 */
export function runNestingWithProgress(
  project: Project,
  rawParams: unknown,
  hooks: NestHooks = {},
): RunNestingApplied {
  const parsed = runNestingParamsSchema.safeParse(rawParams);
  if (!parsed.success) return { ok: false, error: 'invalid params for runNesting' };
  const params = parsed.data;
  const layout = nestProject(
    project,
    { toolDiameter: params.toolDiameter, contourTool: params.contourTool },
    hooks,
  ).layout;
  const [next, patches, inversePatches] = produceWithPatches(project, (draft) => {
    setLayout(draft as Project, project, layout);
  });
  return { ok: true, project: next, params, patches, inversePatches };
}

export const lockPlacementParamsSchema = z
  .strictObject({
    partId: placementSchema.shape.partId,
    /** Which copy of the part. */
    index: placementSchema.shape.index,
    /** New bottom-left corner of the rotated bounding box, mm (sheet frame). Pass x and y together. */
    x: placementSchema.shape.x.optional(),
    y: placementSchema.shape.y.optional(),
    rot: placementSchema.shape.rot.optional(),
    /** Lock (default) or unlock the placement. */
    locked: z.boolean({ error: 'must be true or false' }).default(true),
  })
  .refine((p) => (p.x === undefined) === (p.y === undefined), {
    error: 'pass x and y together',
  });

/**
 * Manual intervention (spec §6.2 "Elle müdahale"): moves a placed part copy and locks it, or only
 * toggles its lock. One undo step. Re-nesting never moves a locked placement. The position is not
 * judged here (the command has no tool diameter); the `LOCKED_PLACEMENT_INVALID` rule reports a
 * locked placement in the margin, off the sheet or too close to another part, and the layout view
 * refuses such drops before calling this. Not an AI tool: placements are geometry (spec §5.4).
 */
export const lockPlacement = defineCommand({
  name: 'lockPlacement',
  area: 'nesting',
  description:
    'Move a placed part copy to x, y (mm, sheet frame) with an optional rotation and lock it, or lock/unlock it in place.',
  aiTool: false,
  params: lockPlacementParamsSchema,
  check: (project, params) => {
    const placed = project.layout.sheets.some((sh) =>
      sh.placements.some((p) => p.partId === params.partId && p.index === params.index),
    );
    if (!placed) return `copy ${params.index} of part "${params.partId}" is not placed`;
    if (params.rot !== undefined) {
      // The grain rule (D-034): only rotations from `allowedRotations` may be set by hand.
      const part = project.parts.find((p) => p.id === params.partId);
      const policy = rotationPolicyOf(project.nesting);
      if (!part || !rotationAllowed(part, defaultSheet(project), params.rot, policy)) {
        const allowed = part ? allowedRotations(part, defaultSheet(project), policy) : [];
        return `rotation ${params.rot}° is not allowed for part "${params.partId}" (allowed: ${allowed.join(', ')})`;
      }
    }
    return undefined;
  },
  apply: (draft, params) => {
    for (const sheet of draft.layout.sheets) {
      const pl = sheet.placements.find(
        (p) => p.partId === params.partId && p.index === params.index,
      );
      if (!pl) continue;
      if (params.x !== undefined && params.y !== undefined) {
        // Assign only real changes so an unchanged drop records no undo step.
        if (pl.x !== params.x) pl.x = params.x;
        if (pl.y !== params.y) pl.y = params.y;
      }
      if (params.rot !== undefined && pl.rot !== params.rot) pl.rot = params.rot;
      if (pl.locked !== params.locked) pl.locked = params.locked;
      return;
    }
  },
});
