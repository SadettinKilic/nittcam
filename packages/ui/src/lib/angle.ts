// Grain-angle maths for the GrainDial (T115, D-034, spec §3.6). Pure.
// Convention: degrees counter-clockwise from the +x axis (0° = horizontal, 90° = vertical), the
// same as the core grain model. A grain is an undirected line, so angles live in [0, 180).

/** Angle steps the dial snaps to while dragging. */
export const GRAIN_SNAP_STEP = 45;
/** Snap tolerance in degrees (± around a multiple of the step). */
export const GRAIN_SNAP_TOLERANCE = 3;

/** Normalises any angle to [0, 180); rounds away binary noise (3 decimals, like core). */
export function normalizeGrainAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const r = Math.round((((angle % 180) + 180) % 180) * 1000) / 1000;
  return r >= 180 ? 0 : r;
}

/**
 * Pointer offset from the dial centre in **screen** coordinates (y grows down) → grain angle in
 * [0, 180), rounded to whole degrees. Both ends of the diameter give the same angle.
 * Returns null at the exact centre (no direction).
 */
export function pointerToGrainAngle(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return normalizeGrainAngle(Math.round(deg));
}

/**
 * Snaps to the nearest multiple of `step` when within `tolerance` (mod 180, so 178° snaps to 0°).
 * Returns the angle unchanged otherwise.
 */
export function snapGrainAngle(
  angle: number,
  step = GRAIN_SNAP_STEP,
  tolerance = GRAIN_SNAP_TOLERANCE,
): number {
  const a = normalizeGrainAngle(angle);
  const nearest = Math.round(a / step) * step;
  return Math.abs(a - nearest) <= tolerance ? normalizeGrainAngle(nearest) : a;
}

/** True when the angle sits exactly on a snap multiple (lights the tick under it). */
export function isSnappedGrainAngle(angle: number, step = GRAIN_SNAP_STEP): boolean {
  const a = normalizeGrainAngle(angle);
  return Math.abs(a - Math.round(a / step) * step) < 1e-6;
}

/** Keyboard step: adds `delta` degrees and wraps into [0, 180). */
export function stepGrainAngle(angle: number, delta: number): number {
  return normalizeGrainAngle(angle + delta);
}

/** Point on a circle for a CCW angle, in screen coordinates (y down). */
export function polarToScreen(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  const t = (angleDeg * Math.PI) / 180;
  return { x: round4(cx + r * Math.cos(t)), y: round4(cy - r * Math.sin(t)) };
}

function round4(v: number): number {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
}
