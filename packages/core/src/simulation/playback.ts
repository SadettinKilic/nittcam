/**
 * Playback model of the simulation (T020, D-028): pure functions from a time (s) to the step in
 * progress, the drawn position and the G-code line, and back from a line to a time. The UI keeps
 * only the playhead time; everything else is derived here.
 *
 * Convention: at time t, every step with `t1 ≤ t` is **done** (drawn completely); the step with
 * `t0 < t < t1` is **active** (drawn up to the interpolated point). Between steps (a dwell) no step
 * is active.
 */
import type { SimSheet, SimStep } from './types';

/** Times closer than this are equal, s. */
export const SIM_TIME_EPS = 1e-9;

type Timed = Pick<SimStep, 't0' | 't1'>;

export interface SimPlayhead {
  /** Number of completed steps (steps[0 .. done-1]). */
  done: number;
  /** Index of the step in progress, or -1. */
  active: number;
  /** Progress of the active step, 0..1 (0 when none). */
  fraction: number;
}

/** Clamps a time into [0, duration]. */
export function clampSimTime(duration: number, t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  return t >= duration ? duration : t;
}

/** Number of steps with t1 ≤ t (binary search; the steps are ordered by time). */
function countDone(steps: readonly Timed[], t: number): number {
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((steps[mid]?.t1 ?? Infinity) <= t + SIM_TIME_EPS) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Which steps are done and which one is in progress at time t. */
export function simPlayheadAt(steps: readonly Timed[], t: number): SimPlayhead {
  const done = countDone(steps, t);
  const next = steps[done];
  if (next && next.t0 < t - SIM_TIME_EPS) {
    const span = next.t1 - next.t0;
    return { done, active: done, fraction: span > 0 ? (t - next.t0) / span : 1 };
  }
  return { done, active: -1, fraction: 0 };
}

/** Time of the next step boundary after t (the end of the current or the next step). */
export function nextStepTime(steps: readonly Timed[], t: number, duration: number): number {
  const done = countDone(steps, t);
  const next = steps[done];
  return next ? next.t1 : duration;
}

/** Time of the previous step boundary before t (the end of the previous step), or 0. */
export function prevStepTime(steps: readonly Timed[], t: number): number {
  // Last step with t1 < t (strictly before).
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((steps[mid]?.t1 ?? Infinity) < t - SIM_TIME_EPS) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? (steps[lo - 1]?.t1 ?? 0) : 0;
}

/**
 * Time that shows a G-code line: the end of the move written on that line (so the move is drawn),
 * or for a line without a move (comment, M3, dwell …) the start of the next move after it, or
 * the end of the program when no move follows.
 */
export function timeForLine(
  steps: readonly Pick<SimStep, 't0' | 't1' | 'file' | 'line'>[],
  file: number,
  line: number,
  duration: number,
): number {
  let after: number | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    if (!s) continue;
    if (s.file === file && s.line === line) {
      // A line can only hold one move; take the last in case a caller split it.
      let j = i;
      while (steps[j + 1]?.file === file && steps[j + 1]?.line === line) j += 1;
      return steps[j]?.t1 ?? s.t1;
    }
    if (after === null && (s.file > file || (s.file === file && s.line > line))) after = s.t0;
  }
  return after ?? duration;
}

/**
 * The G-code line to highlight at time t: the active step's line, else the last completed one,
 * else null (nothing has run yet).
 */
export function lineAt(
  steps: readonly Pick<SimStep, 't0' | 't1' | 'file' | 'line'>[],
  t: number,
): { file: number; line: number } | null {
  const ph = simPlayheadAt(steps, t);
  const s = ph.active >= 0 ? steps[ph.active] : steps[ph.done - 1];
  return s ? { file: s.file, line: s.line } : null;
}

/** Point k of the flat points array. */
function point(points: readonly number[], k: number): { x: number; y: number; z: number } {
  return { x: points[3 * k] ?? 0, y: points[3 * k + 1] ?? 0, z: points[3 * k + 2] ?? 0 };
}

/**
 * Tool centre at time t (sheet frame), interpolated along the active step's points by length.
 * Before the first step: the start point.
 */
export function positionAt(
  sim: Pick<SimSheet, 'points' | 'steps'>,
  t: number,
): { x: number; y: number; z: number; step: number } {
  const { steps, points } = sim;
  const ph = simPlayheadAt(steps, t);
  if (ph.active < 0) {
    const last = steps[ph.done - 1];
    if (last) return { ...point(points, last.p1), step: ph.done - 1 };
    const first = steps[0];
    return { ...point(points, first ? first.p0 : 0), step: -1 };
  }
  const s = steps[ph.active] as SimStep;
  // Length along the sampled polyline (equal to the move length up to the chord error).
  let total = 0;
  for (let k = s.p0; k < s.p1; k += 1) {
    const a = point(points, k);
    const b = point(points, k + 1);
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  let left = total * ph.fraction;
  for (let k = s.p0; k < s.p1; k += 1) {
    const a = point(points, k);
    const b = point(points, k + 1);
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (left <= d || k === s.p1 - 1) {
      const f = d > 0 ? Math.min(1, left / d) : 1;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        step: ph.active,
      };
    }
    left -= d;
  }
  return { ...point(points, s.p1), step: ph.active };
}

/** Playback speed in simulated seconds per real second; "max" plays the sheet in ~10 s. */
export function playbackRate(speed: number | 'max', duration: number): number {
  if (speed === 'max') return Math.max(20, duration / 10);
  return speed > 0 ? speed : 1;
}
