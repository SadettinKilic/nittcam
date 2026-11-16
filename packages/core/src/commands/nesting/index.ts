/** Nesting commands (spec §5.1 "Dizilim", §6.2, D-019). */
import { original } from 'immer';
import { z } from 'zod';
import { PROFILE_BOUNDS } from '../../machine/profile';
import { nestProject } from '../../nesting/nest';
import { nestingSchema, type Project } from '../../schema';
import { defineCommand } from '../types';

/** Sets the nesting goal, part gap and sheet margin. At least one field is required. */
export const setNestingOptions = defineCommand({
  name: 'setNestingOptions',
  area: 'nesting',
  description:
    'Set nesting options: mode ("minWaste", "fastest" or "minToolChanges"), the gap between parts in millimetres and the sheet edge margin in millimetres. Pass only the fields to change.',
  aiTool: true,
  params: z
    .strictObject({
      mode: nestingSchema.shape.mode.optional(),
      gap: nestingSchema.shape.gap.optional(),
      margin: nestingSchema.shape.margin.optional(),
    })
    .refine((p) => p.mode !== undefined || p.gap !== undefined || p.margin !== undefined, {
      error: 'pass at least one of mode, gap, margin',
    }),
  apply: (draft, params) => {
    if (params.mode !== undefined) draft.nesting.mode = params.mode;
    if (params.gap !== undefined) draft.nesting.gap = params.gap;
    if (params.margin !== undefined) draft.nesting.margin = params.margin;
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
    'Run nesting: place all part copies on sheets with the current nesting options. Locked placements are kept. toolDiameter is the cutting tool diameter in millimetres from the machine profile.',
  aiTool: true,
  params: runNestingParamsSchema,
  apply: (draft, params) => {
    // Nothing is changed on the draft before this point, so the original is the current project.
    const project = original(draft) as Project;
    const layout = nestProject(project, { toolDiameter: params.toolDiameter }).layout;
    // Same layout as stored (a re-run without changes): leave the draft untouched, so the command
    // records no undo step.
    if (JSON.stringify(layout) !== JSON.stringify(project.layout)) draft.layout = layout;
  },
});
