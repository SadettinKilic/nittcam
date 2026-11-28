/**
 * The fixed material kinds of a machine profile's parameter sets (§3.6), in menu order. Plain
 * data without zod (T186), so UI code that only maps or lists kinds stays light;
 * `materialKindSchema` in `profile.ts` is built from this list.
 */
export const MATERIAL_KIND_IDS = [
  'mdf',
  'plywood',
  'melamine',
  'solidWood',
  'acrylic',
  'pvc',
  // M-Metal tier A/B (T346, D-130): visible without a flag; aluminium NC stays blocked (T358/T359).
  'acm',
  'aluminium',
] as const;

export type MaterialKind = (typeof MATERIAL_KIND_IDS)[number];
