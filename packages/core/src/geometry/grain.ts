/**
 * Grain follows the physical piece (D-038): when a part is rotated or mirrored on the drawing
 * board, its grain line turns with the shape, so the grain relative to the part's geometry stays
 * the same. Grain is an undirected line (D-034), so angles live in [0, 180).
 */
import type { QuarterTurn } from './transform';

/** Normalises a grain angle (degrees) to [0, 180); 30° and 210° are the same grain. */
export function normalizeGrain(angle: number): number {
  // Rounded to 1e-9° so repeated turns never accumulate float noise (4 × 90° is an exact identity).
  const a = Math.round((((angle % 180) + 180) % 180) * 1e9) / 1e9;
  // Avoid -0 and float noise right below 180.
  return a === 0 || a >= 180 ? 0 : a;
}

/** Grain angle after rotating the part by a quarter turn counter-clockwise. */
export function turnGrain(angle: number, turns: QuarterTurn): number {
  return normalizeGrain(angle + turns);
}

/**
 * Grain angle after mirroring the part on either axis: `h` flips left ↔ right (x → −x), `v` flips top ↔ bottom
 * (y → −y). Both reflect a line at angle a to −a (mod 180).
 */
export function mirrorGrain(angle: number): number {
  return normalizeGrain(-angle);
}

/** Normalises a rotation (degrees) to [0, 360) with 3 decimals, the stored precision (D-034). */
export function normalizeRotation(deg: number): number {
  const r = Math.round((((deg % 360) + 360) % 360) * 1000) / 1000;
  return r >= 360 || r === 0 ? 0 : r;
}

/** A part's grain as `allowedRotations` reads it (schema v2 `part.grain`). */
export interface GrainOfPart {
  grain: { mode: 'free' | 'fixed'; angle: number };
}

/** Rotation policy for parts without a grain rule (true-shape steps come later, T166). */
export interface RotationPolicy {
  /** Rotations (degrees) a free part may take; default 0/90/180/270. */
  freeRotations?: readonly number[];
}

const QUARTER_TURNS: readonly number[] = [0, 90, 180, 270];

/**
 * The rotations (CCW degrees, [0, 360), 3 decimals, ascending) at which a part may be placed on a
 * sheet (D-034). The single source for the placer, layout drag and validation.
 * - fixed grain on a sheet with grain: exactly g and g + 180 with g = sheet − part (mod 360), so
 *   (part angle + rot) ≡ sheet angle (mod 180);
 * - free grain, or a sheet without grain (`null`): the policy's free rotations (0/90/180/270).
 */
export function allowedRotations(
  part: GrainOfPart,
  sheet: { grain: number | null },
  policy: RotationPolicy = {},
): number[] {
  const free = policy.freeRotations ?? QUARTER_TURNS;
  const raw =
    part.grain.mode === 'fixed' && sheet.grain !== null
      ? [sheet.grain - part.grain.angle, sheet.grain - part.grain.angle + 180]
      : free;
  return [...new Set(raw.map(normalizeRotation))].sort((a, b) => a - b);
}
