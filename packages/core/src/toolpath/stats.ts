/**
 * Approximate toolpath statistics (D-021): cut length, rapid length, machining time. Rapids from
 * one operation to the next count only on the same sheet (each sheet is its own program); the very
 * first rapid of a sheet starts at an unknown position and is not counted. Acceleration, tool
 * changes and the spindle warm-up are ignored. Pure.
 *
 * T335 (field rehearsal N4, D-127): a feed move never counts faster than the machine runs it: its
 * feed is clamped at the machine's ceiling (`cap`: cutting feed, or plunge feed for a move going
 * down into the material; `machineFeedLimits`) and at the rapid rate.
 */
import { segmentLength } from '../geometry/segment';
import { operationMoves } from './safety';
import type { Move, Toolpath, ToolpathSummary } from './types';

interface Pos {
  x: number;
  y: number;
  z: number;
}

/** 3D length of a move from `from` (helical length for arcs that change Z). */
export function moveLength(from: Pos, m: Move): number {
  const dz = m.z - from.z;
  if (m.kind === 'arc') {
    const xy = segmentLength(from, m, m.bulge);
    return Math.hypot(xy, dz);
  }
  return Math.hypot(m.x - from.x, m.y - from.y, dz);
}

/** Machine feed ceiling of the time estimate, mm/min (T335). */
export interface FeedCap {
  feed: number;
  plunge: number;
}

/** The feed a move really runs at: programmed, clamped at the ceiling and the rapid rate. */
export function effectiveFeed(
  feed: number,
  fromZ: number,
  toZ: number,
  rapidFeed: number,
  cap?: FeedCap,
): number {
  const down = toZ < fromZ - 1e-9 && toZ < -1e-9;
  const ceiling = cap ? (down ? cap.plunge : cap.feed) : Number.POSITIVE_INFINITY;
  return Math.min(feed, ceiling, rapidFeed);
}

export function summarizeToolpath(tp: Toolpath, rapidFeed: number, cap?: FeedCap): ToolpathSummary {
  let cutLength = 0;
  let rapidLength = 0;
  let minutes = 0;
  let prev: Pos | null = null;
  let sheet = -1;
  for (const op of tp.operations) {
    if (op.sheet !== sheet) {
      prev = null;
      sheet = op.sheet;
    }
    for (const m of operationMoves(op)) {
      if (prev) {
        const len = moveLength(prev, m);
        if (m.kind === 'rapid') {
          rapidLength += len;
          minutes += len / rapidFeed;
        } else {
          cutLength += len;
          minutes += len / effectiveFeed(m.feed, prev.z, m.z, rapidFeed, cap);
        }
      }
      prev = { x: m.x, y: m.y, z: m.z };
    }
  }
  return {
    cutLength,
    rapidLength,
    estimatedSeconds: minutes * 60,
    operationCount: tp.operations.length,
  };
}
