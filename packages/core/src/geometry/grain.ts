/**
 * Grain follows the physical piece (D-038): when a part is rotated or mirrored on the drawing
 * board, its grain line turns with the shape, so the grain relative to the part's geometry stays
 * the same. Grain is an undirected line (D-034), so angles live in [0, 180).
 */
import type { QuarterTurn } from './transform';

/** Normalises a grain angle (degrees) to [0, 180); 30° and 210° are the same grain. */
export function normalizeGrain(angle: number): number {
  const a = ((angle % 180) + 180) % 180;
  // Avoid -0 and float noise right below 180.
  return a === 0 || Math.abs(a - 180) < 1e-9 ? 0 : a;
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
