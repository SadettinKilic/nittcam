/**
 * Montaj tezgâhı (T386, D-131): where each part copy stands in the project's 3D assembly.
 * Display only: nesting, toolpath and NC never read it. Old projects have no `assembly` (read as
 * empty: every copy at its seeded place, worked out by the app).
 *
 * Frame: millimetres, y up from the floor, x right, z toward the viewer (the cabinet frame of T158).
 * A part's local frame is the one of T153 (x along w, y along h, z = 0 sheet bottom, z = T the
 * machined top). `position` is the world position of the part's local bounding-box centre;
 * `rotation` is a unit quaternion [x, y, z, w] turning the local axes into the world:
 * world = position + R · (local − centre).
 */
import { z } from 'zod';

/** Largest coordinate a placed part may have, mm (a 100 m workbench). */
export const ASSEMBLY_COORD_MAX = 100_000;
/** At most this many placed copies per project (spec §3.8 budget is 300; room to spare). */
export const ASSEMBLY_INSTANCES_MAX = 5000;

const worldMm = z
  .number({ error: 'must be a number (mm)' })
  .min(-ASSEMBLY_COORD_MAX, { error: `must be within ±${ASSEMBLY_COORD_MAX} mm` })
  .max(ASSEMBLY_COORD_MAX, { error: `must be within ±${ASSEMBLY_COORD_MAX} mm` });

const quatPart = z
  .number({ error: 'must be a number' })
  .min(-1.000001, { error: 'quaternion parts lie in [-1, 1]' })
  .max(1.000001, { error: 'quaternion parts lie in [-1, 1]' });

export const assemblyInstanceSchema = z.strictObject({
  /** Unique within the assembly; the app uses `<partId>#<copy>`. */
  id: z.string({ error: 'must be a string' }).min(1, { error: 'must not be empty' }).max(200),
  partId: z.string({ error: 'must be a string' }).min(1, { error: 'must not be empty' }),
  /** Which copy of the part (0 … qty − 1). */
  copy: z
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(0, { error: 'must be >= 0' }),
  position: z.tuple([worldMm, worldMm, worldMm]),
  rotation: z
    .tuple([quatPart, quatPart, quatPart, quatPart])
    .refine(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) <= 1e-3, {
      error: 'rotation must be a unit quaternion',
    }),
  hidden: z.boolean({ error: 'must be true or false' }),
});

export const assemblySchema = z.strictObject({
  instances: z.array(assemblyInstanceSchema).max(ASSEMBLY_INSTANCES_MAX),
  /** Last edit (ISO 8601), passed in by the caller (core has no clock). */
  updatedAt: z.iso.datetime({ offset: true, error: 'updatedAt must be an ISO 8601 date-time' }),
});

export type AssemblyInstance = z.infer<typeof assemblyInstanceSchema>;
export type Assembly = z.infer<typeof assemblySchema>;

/** The id the app gives the instance of one part copy. */
export function assemblyInstanceId(partId: string, copy: number): string {
  return `${partId}#${copy}`;
}

/**
 * Keeps the assembly valid after a part edit (T386): instances of deleted parts and of copies above
 * the quantity are removed, duplicates (same id, or same part copy) keep the first. Works on a
 * plain project or an Immer draft; changes nothing when nothing is stale (no patches).
 */
export function pruneAssembly(project: {
  parts: readonly { id: string; qty: number }[];
  assembly?: { instances: readonly AssemblyInstance[] } | undefined;
}): void {
  const assembly = project.assembly;
  if (!assembly || assembly.instances.length === 0) return;
  const qty = new Map(project.parts.map((p) => [p.id, p.qty]));
  const ids = new Set<string>();
  const copies = new Set<string>();
  const keep = (i: AssemblyInstance) => {
    const q = qty.get(i.partId);
    if (q === undefined || i.copy >= q) return false;
    const copy = assemblyInstanceId(i.partId, i.copy);
    if (ids.has(i.id) || copies.has(copy)) return false;
    ids.add(i.id);
    copies.add(copy);
    return true;
  };
  // Only when something goes is the array replaced, so the common case leaves no patch.
  if (assembly.instances.every(keep)) return;
  ids.clear();
  copies.clear();
  assembly.instances = assembly.instances.filter(keep);
}
