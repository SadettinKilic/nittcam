/**
 * Company project defaults (T182, spec §3.4 "Ayarlar ... varsayılanları"): what a new project
 * starts with for part gap, sheet margin, tab mode, lead-in, cut direction and the edge-band
 * (dimension) mode. They are applied once, when the project is created, through the same command
 * logic the project screens use (`setTabs`, `setLeadIn`, `setCutDirection`, `setDimensionMode`),
 * so a default and a later hand change can never mean different things (D-067).
 *
 * Tab count / width / height are deliberately not here: they stay in the machine profile's
 * material set (D-022, T288 "Malzeme ayarına dön"), the one source of tab sizes. Pure.
 */
import { z } from 'zod';
import type { Project } from '../schema';
import { setCutDirection, setDimensionMode, setLeadIn, setTabs, tabModeSchema } from './plate';

/** Upper bound of the gap and margin defaults, mm. */
export const PROJECT_DEFAULT_MM_MAX = 100;

const mm = z
  .number({ error: 'must be a number (mm)' })
  .min(0, { error: 'must be >= 0' })
  .max(PROJECT_DEFAULT_MM_MAX, { error: `must be at most ${PROJECT_DEFAULT_MM_MAX} mm` });

export const projectDefaultsSchema = z.strictObject({
  /** Gap between parts, mm (`nesting.gap`). */
  gap: mm,
  /** Sheet edge margin, mm (`nesting.margin`). */
  margin: mm,
  /** `setTabs` mode: every part / small parts only / none (thin skin). */
  tabMode: tabModeSchema,
  leadIn: z.enum(['arc', 'line'], { error: 'leadIn must be "arc" or "line"' }),
  direction: z.enum(['climb', 'conventional'], {
    error: 'direction must be "climb" or "conventional"',
  }),
  /** Edge-band mode (§4.8): sizes are cut sizes or finished sizes. */
  dimensionMode: z.enum(['cut', 'finished'], {
    error: 'dimensionMode must be "cut" or "finished"',
  }),
});
export type ProjectDefaults = z.infer<typeof projectDefaultsSchema>;

/** What a project starts with when the company changed nothing (the values before T182). */
export const BUILT_IN_PROJECT_DEFAULTS: Readonly<ProjectDefaults> = Object.freeze({
  gap: 8,
  margin: 10,
  tabMode: 'all',
  leadIn: 'arc',
  direction: 'climb',
  dimensionMode: 'cut',
});

/**
 * Stored defaults (any JSON) → complete defaults: every valid field is kept, a missing or invalid
 * one falls back to the built-in value. Never throws.
 */
export function resolveProjectDefaults(raw: unknown): ProjectDefaults {
  const out: Record<string, unknown> = { ...BUILT_IN_PROJECT_DEFAULTS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const shape = projectDefaultsSchema.shape;
    for (const key of Object.keys(shape) as (keyof ProjectDefaults)[]) {
      const r = shape[key].safeParse((raw as Record<string, unknown>)[key]);
      if (r.success) out[key] = r.data;
    }
  }
  return out as ProjectDefaults;
}

/** A copy of `project` with the defaults applied (a new, empty project; nothing is logged). */
export function applyProjectDefaults(project: Project, defaults: ProjectDefaults): Project {
  const draft = structuredClone(project);
  draft.nesting.gap = defaults.gap;
  draft.nesting.margin = defaults.margin;
  setTabs.apply(draft, { mode: defaults.tabMode });
  setLeadIn.apply(draft, { leadIn: defaults.leadIn });
  setCutDirection.apply(draft, { direction: defaults.direction });
  setDimensionMode.apply(draft, { mode: defaults.dimensionMode });
  return draft;
}
