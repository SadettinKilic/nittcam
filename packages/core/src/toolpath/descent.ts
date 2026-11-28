/**
 * Zig-zag descent along a path (T423, spec §7.2 rule 12, §6.3). Pure.
 *
 * A material that takes no straight plunge (`traits.entry.straightPlunge = false`: ACM, aluminium)
 * must never get a vertical feed move into material. Where the toolpath has to go down inside the
 * cut (a V-groove pass entry, the end of a tab), it goes down on a zig-zag along the path ahead:
 * forward over a leg, back over the same leg, and so on, each leg at most `angleDeg` steep. It ends
 * where it started, at the new depth, so the pass that follows still covers the whole path at that
 * depth (a V-groove keeps one depth over its full fold line; a tab keeps its flank).
 *
 * Two legs when `room` (the path ahead) holds the leg the angle needs; otherwise more, shorter
 * legs over the whole room (never steeper).
 */
import { EPS } from '../geometry/constants';
import { pathLength, pathMoves, reversePath, subpath, type PathSeg } from './path';
import type { FeedMove } from './types';

/** Shortest room a zig-zag uses, mm; below it the descent cannot be made shallow. */
export const DESCENT_MIN_ROOM = 0.05;

/**
 * Moves from the start of `room` at `zFrom` down to the same point at `zTo`, every move at most
 * `angleDeg` steep (descent over XY travel). Empty when there is nothing to descend. Null when the
 * room is too short for any ramp (the caller must not plunge there).
 */
export function zigzagDescent(
  room: readonly PathSeg[],
  zFrom: number,
  zTo: number,
  angleDeg: number,
  feed: number,
): FeedMove[] | null {
  const drop = zFrom - zTo;
  if (!(drop > EPS / 100)) return [];
  const avail = pathLength(room);
  const tan = Math.tan((angleDeg * Math.PI) / 180);
  if (!(tan > 0) || !(avail >= DESCENT_MIN_ROOM)) return null;
  // Two legs of the length the angle needs, or 2k legs over the whole room.
  const ideal = drop / 2 / tan;
  let legs = 2;
  let leg = ideal;
  if (ideal > avail) {
    leg = avail;
    legs = 2 * Math.ceil(drop / (2 * avail * tan) - 1e-9);
  }
  const fwd = subpath(room, leg);
  const back = reversePath(fwd);
  const moves: FeedMove[] = [];
  for (let i = 0; i < legs; i++) {
    const z0 = zFrom - (drop * i) / legs;
    const z1 = i === legs - 1 ? zTo : zFrom - (drop * (i + 1)) / legs;
    moves.push(...pathMoves(i % 2 === 0 ? fwd : back, z0, z1, feed));
  }
  return moves;
}
