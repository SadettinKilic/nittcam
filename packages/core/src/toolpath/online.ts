/**
 * On-line operation (T142, spec §4.6 "Çizgi üzerinden", §6.3): the tool centre follows the line
 * itself (no offset) at a set depth, for engraving. Closed contours and open lines. Never a
 * through cut (depth < thickness), so no leads, tabs or small-part rules apply. Pure.
 *
 * Moves: XY rapid at safe Z to the start, rapid down to the clearance height, plunge at plunge
 * feed, one pass per depth. A closed contour repeats the loop and steps down at its start; an
 * open line goes back and forth (each step down happens in its own kerf at the end it reached).
 * Retract to safe Z where the last pass ends.
 */
import { EPS } from '../geometry/constants';
import type { Point, Polyline, Vertex } from '../geometry/types';
import { loopSegments, pathMoves, reversePath, type PathSeg } from './path';
import type { Move, MoveSegment, Operation } from './types';

export interface OnlineInput {
  id: string;
  sheet: number;
  partId: string;
  copy: number;
  /** The line in the sheet frame; `closed` decides loop or back-and-forth. */
  line: Polyline;
  tool: number;
  toolDiameter: number;
  feed: number;
  plungeFeed: number;
  rpm: number;
  /** Pass depths (negative Z), last = the operation depth. */
  passDepths: number[];
  safeZ: number;
  clearanceZ: number;
  /** T353: `vgroove` = the same centre-line path as a V-groove (fold line). Default `online`. */
  kind?: 'online' | 'vgroove';
}

/** Segments of an open polyline (no closing segment; the last vertex's bulge is unused). */
export function openSegments(vs: readonly Vertex[]): PathSeg[] {
  return vs.slice(0, -1).map((v, i) => {
    const next = vs[i + 1] as Vertex;
    return { p0: { x: v.x, y: v.y }, p1: { x: next.x, y: next.y }, bulge: v.bulge };
  });
}

/** Drops zero-length segments (repeated points) so no empty feed moves are written. */
function nonEmpty(segs: PathSeg[]): PathSeg[] {
  return segs.filter((s) => Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) > EPS);
}

export function buildOnlineOperation(o: OnlineInput): Operation {
  const fwd = nonEmpty(o.line.closed ? loopSegments(o.line) : openSegments(o.line.vertices));
  const back = reversePath(fwd);
  const first = fwd[0];
  const start: Point = first
    ? first.p0
    : { x: o.line.vertices[0]?.x ?? 0, y: o.line.vertices[0]?.y ?? 0 };
  const firstZ = o.passDepths[0] as number;

  const approach: Move[] = [{ kind: 'rapid', x: start.x, y: start.y, z: o.safeZ }];
  if (o.clearanceZ < o.safeZ - EPS) {
    approach.push({ kind: 'rapid', x: start.x, y: start.y, z: o.clearanceZ });
  }
  approach.push({ kind: 'plunge', x: start.x, y: start.y, z: firstZ, feed: o.plungeFeed });
  const segments: MoveSegment[] = [{ role: 'approach', moves: approach }];

  let at = start;
  o.passDepths.forEach((z, i) => {
    const moves: Move[] = [];
    if (i > 0) moves.push({ kind: 'plunge', x: at.x, y: at.y, z, feed: o.plungeFeed });
    // Open line: odd passes run backwards from the end the previous pass reached.
    const path = o.line.closed || i % 2 === 0 ? fwd : back;
    moves.push(...pathMoves(path, z, z, o.feed));
    const last = path[path.length - 1];
    if (last) at = last.p1;
    segments.push({
      role: 'pass',
      pass: i,
      depth: z,
      final: i === o.passDepths.length - 1,
      moves,
    });
  });
  segments.push({ role: 'retract', moves: [{ kind: 'rapid', x: at.x, y: at.y, z: o.safeZ }] });

  return {
    id: o.id,
    kind: o.kind ?? 'online',
    sheet: o.sheet,
    partId: o.partId,
    copy: o.copy,
    tool: o.tool,
    toolDiameter: o.toolDiameter,
    rpm: o.rpm,
    feed: o.feed,
    plungeFeed: o.plungeFeed,
    // No side to climb on: the travel is the line's own direction (closed lines are stored CCW).
    travel: 'ccw',
    passDepths: [...o.passDepths],
    tabs: [],
    segments,
  };
}

/** Start point and (for an open line) end point; the cut order only uses the start. */
export function onlineStart(op: Operation): Point {
  const m = op.segments[0]?.moves[0];
  return { x: m?.x ?? 0, y: m?.y ?? 0 };
}
