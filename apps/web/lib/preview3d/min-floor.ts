/**
 * Smallest blind floor kept below the top (mm): a deeper pocket/groove is drawn as through.
 * Own module without `three`, so the eager `assembly.ts` (T310) does not pull the 3D chunk into
 * the wizard's first load (T186 budget).
 */
export const MIN_FLOOR = 0.05;
