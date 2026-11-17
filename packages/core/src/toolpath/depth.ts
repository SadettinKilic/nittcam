/**
 * Cut depth and passes (spec §6.3 "Derinlik", §4.5, D-021). Pure.
 */
import { EPS } from '../geometry/constants';

/** Through-cut target Z: −(thickness + spoilboard allowance), spec §4.5 / §6.3. */
export function throughCutTarget(thickness: number, spoilboardAllowance: number): number {
  return 0 - (thickness + spoilboardAllowance);
}

/**
 * Z of every pass for a cut down to `target` (negative) with at most `passDepth` per pass:
 * n = ceil(|target| / passDepth) equal passes; the last one is exactly `target`. A depth that
 * exceeds a whole number of passes by less than EPS does not add a pass (18.3 / 6.1 is 3 passes,
 * not 4 because of float rounding).
 */
export function passDepths(target: number, passDepth: number): number[] {
  if (!(passDepth > 0) || !Number.isFinite(passDepth) || !Number.isFinite(target) || target >= 0) {
    throw new RangeError('passDepths needs a negative target and a positive pass depth');
  }
  const total = 0 - target;
  const n = Math.max(1, Math.ceil((total - EPS) / passDepth));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? target : 0 - (total * (i + 1)) / n));
}
