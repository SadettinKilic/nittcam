/**
 * Contour pocket (T325, D-112): a closed inner contour cleared flat to a blind depth. Pure.
 *
 * Clearing: offset rings of the contour (own offset kernel, D-013). The wall ring is the contour
 * offset inward by the tool radius (the finishing ring, cut last on every pass); further rings
 * step inward by at most `stepoverFraction` × the tool diameter until the offset collapses. Every
 * point of the pocket is then within one step (≤ the tool radius) of a ring, so the floor is
 * cleared; only the concave corners keep the tool radius (a sharp rectangle corner stays R = r).
 * A shape whose rings split into separate islands (a narrow neck) is refused: one entry per pocket.
 *
 * Moves per pass: entry on the innermost ring (a ramp along the ring, at most `rampAngleDeg`
 * steep, several laps when needed; a straight plunge with a warning only when the ring is shorter
 * than the tool diameter), one flat lap on it, then each ring outwards, joined by a short feed
 * move to the nearest point of the next ring (inside the band being cleared). Between passes the
 * tool goes up to safe Z, back over the entry and down to the previous floor at the plunge feed.
 * Climb inside a pocket with a CW spindle = CCW travel (D-021), like the hole pockets.
 */
import { EPS } from '../geometry/constants';
import { offset } from '../geometry/offset';
import { normalize } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Polyline } from '../geometry/types';
import {
  loopSegments,
  pathLength,
  pathMoves,
  segLength,
  slicePath,
  startAtLongestLine,
  type PathSeg,
} from './path';
import type { Move, MoveSegment, Operation, ToolpathCode } from './types';

export const CONTOUR_POCKET_DEFAULTS = {
  /** Ring step as a fraction of the tool diameter (spec task: ≤ ~50 %). */
  stepoverFraction: 0.4,
  /** Ramp angle of the entry against the XY plane, degrees. */
  rampAngleDeg: 3,
  /** Most ramp laps per pass on the entry ring; a ring too short for them gets a plunge entry. */
  maxRampLaps: 8,
  /** Safety limit of rings (a 2 m pocket with a 1 mm tool stays far below it). */
  maxRings: 5000,
} as const;

export type ContourPocketRings =
  | { ok: true; rings: Polyline[]; arcCollapsed: boolean }
  | {
      ok: false;
      code: Extract<ToolpathCode, 'POCKET_TOO_SMALL' | 'POCKET_SPLIT'>;
      message: string;
    };

/**
 * Clearing rings of a pocket contour (any direction), innermost first, the wall ring last; every
 * ring is CCW. `POCKET_TOO_SMALL`: the tool does not fit (the wall offset fails); `POCKET_SPLIT`:
 * a ring breaks into islands.
 */
export function contourPocketRings(inner: Polyline, toolDiameter: number): ContourPocketRings {
  const r = toolDiameter / 2;
  const cw = normalize(inner, 'inner');
  const step = CONTOUR_POCKET_DEFAULTS.stepoverFraction * toolDiameter;
  const wall = r > 0 ? offset(cw, r) : null;
  if (!wall || !wall.ok || wall.polylines.length === 0) {
    return {
      ok: false,
      code: 'POCKET_TOO_SMALL',
      message: `The pocket is narrower than the tool (Ø${toolDiameter} mm).`,
    };
  }
  if (wall.warnings.includes('SPLIT') || wall.polylines.length !== 1) {
    return {
      ok: false,
      code: 'POCKET_SPLIT',
      message: 'The tool cannot pass a narrow neck of the pocket; it would need two entries.',
    };
  }
  const rings = [wall.polylines[0] as Polyline];
  for (let k = 1; k < CONTOUR_POCKET_DEFAULTS.maxRings; k++) {
    const res = offset(cw, r + k * step);
    if (!res.ok || res.polylines.length === 0) break;
    if (res.warnings.includes('SPLIT') || res.polylines.length !== 1) {
      return {
        ok: false,
        code: 'POCKET_SPLIT',
        message: 'The pocket narrows into separate islands; it cannot be cleared from one entry.',
      };
    }
    rings.push(res.polylines[0] as Polyline);
  }
  return {
    ok: true,
    rings: rings.reverse().map((p) => normalize(p, 'outer')),
    arcCollapsed: wall.warnings.includes('ARC_COLLAPSED'),
  };
}

/** Arc length along `segs` of the point nearest to `p` (lines exact, arcs sampled finely). */
function nearestOnPath(segs: readonly PathSeg[], p: Point): number {
  let best = Infinity;
  let bestS = 0;
  let s0 = 0;
  for (const s of segs) {
    const len = segLength(s);
    if (s.bulge === 0) {
      const dx = s.p1.x - s.p0.x;
      const dy = s.p1.y - s.p0.y;
      const l2 = dx * dx + dy * dy;
      const t =
        l2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.p0.x) * dx + (p.y - s.p0.y) * dy) / l2)) : 0;
      const d = Math.hypot(p.x - s.p0.x - t * dx, p.y - s.p0.y - t * dy);
      if (d < best - EPS) {
        best = d;
        bestS = s0 + t * len;
      }
    } else {
      const pts = sampleSegment(s.p0, s.p1, s.bulge, 64);
      pts.forEach((q, i) => {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < best - EPS) {
          best = d;
          bestS = s0 + (len * i) / 64;
        }
      });
    }
    s0 += len;
  }
  return bestS;
}

/** The closed loop `segs` started at arc length `at`. */
function loopFrom(segs: readonly PathSeg[], at: number): PathSeg[] {
  const total = pathLength(segs);
  if (at <= EPS || at >= total - EPS) return [...segs];
  return [...slicePath(segs, at, total), ...slicePath(segs, 0, at)];
}

export interface ContourPocketInput {
  id: string;
  sheet: number;
  partId: string;
  copy: number;
  /** Inner contour index of the part. */
  inner: number;
  /** The pocket contour in the sheet frame (any direction). */
  contour: Polyline;
  tool: number;
  toolDiameter: number;
  feed: number;
  plungeFeed: number;
  rpm: number;
  /** Pass depths (negative), last = −pocket depth. */
  passDepths: number[];
  safeZ: number;
  clearanceZ: number;
  travel: 'cw' | 'ccw';
}

export type ContourPocketBuild =
  | { ok: true; operation: Operation; plungeEntry: boolean; arcCollapsed: boolean }
  | {
      ok: false;
      code: Extract<ToolpathCode, 'POCKET_TOO_SMALL' | 'POCKET_SPLIT'>;
      message: string;
    };

/** Whether the entry ring is long enough for a ramp (else a straight plunge, with a warning). */
export function rampFits(entryLength: number, toolDiameter: number): boolean {
  return entryLength >= toolDiameter - EPS;
}

export function buildContourPocketOperation(input: ContourPocketInput): ContourPocketBuild {
  const res = contourPocketRings(input.contour, input.toolDiameter);
  if (!res.ok) return res;
  const ccw = input.travel === 'ccw';
  const loops = res.rings.map((ring) => {
    const segs = loopSegments(ring);
    return ccw ? segs : reverseLoop(segs);
  });
  // Entry ring: start on its longest straight edge (away from corners).
  const entryRing = startAtLongestLine(res.rings[0] as Polyline);
  const entrySegs = ccw ? loopSegments(entryRing) : reverseLoop(loopSegments(entryRing));
  loops[0] = entrySegs;
  const entry = entrySegs[0]?.p0 ?? { x: 0, y: 0 };
  const entryLen = pathLength(entrySegs);
  const tan = Math.tan((CONTOUR_POCKET_DEFAULTS.rampAngleDeg * Math.PI) / 180);
  // Never steeper than rampAngleDeg: when the deepest pass cannot be reached within
  // maxRampLaps on the entry ring, fall back to a straight plunge (POCKET_PLUNGE_ENTRY).
  let maxDrop = 0;
  let zLast = 0;
  for (const z of input.passDepths) {
    maxDrop = Math.max(maxDrop, zLast - z);
    zLast = z;
  }
  const ramp =
    rampFits(entryLen, input.toolDiameter) &&
    maxDrop <= CONTOUR_POCKET_DEFAULTS.maxRampLaps * entryLen * tan + EPS;
  const { safeZ, clearanceZ, plungeFeed, feed } = input;
  const last = input.passDepths.length - 1;
  const segments: MoveSegment[] = [
    {
      role: 'approach',
      moves: [
        { kind: 'rapid', x: entry.x, y: entry.y, z: safeZ },
        { kind: 'rapid', x: entry.x, y: entry.y, z: clearanceZ },
        // Down to the material top at the plunge feed (still in the air).
        { kind: 'plunge', x: entry.x, y: entry.y, z: 0, feed: plungeFeed },
      ],
    },
  ];
  let zPrev = 0;
  let pos: Point = entry;
  input.passDepths.forEach((z, pass) => {
    const moves: Move[] = [];
    if (pass > 0) {
      // Up, over the entry, down to the floor already cleared (nothing crosses a pocket wall).
      moves.push({ kind: 'rapid', x: pos.x, y: pos.y, z: safeZ });
      moves.push({ kind: 'rapid', x: entry.x, y: entry.y, z: safeZ });
      moves.push({ kind: 'rapid', x: entry.x, y: entry.y, z: clearanceZ });
      moves.push({ kind: 'plunge', x: entry.x, y: entry.y, z: zPrev, feed: plungeFeed });
    }
    if (ramp) {
      const drop = zPrev - z;
      const laps = Math.min(
        CONTOUR_POCKET_DEFAULTS.maxRampLaps,
        Math.max(1, Math.ceil(drop / Math.max(entryLen * tan, EPS) - 1e-9)),
      );
      for (let k = 1; k <= laps; k++) {
        const z0 = zPrev - (drop * (k - 1)) / laps;
        const z1 = zPrev - (drop * k) / laps;
        moves.push(...pathMoves(entrySegs, z0, z1, plungeFeed));
      }
    } else {
      moves.push({ kind: 'plunge', x: entry.x, y: entry.y, z, feed: plungeFeed });
    }
    // Flat lap on the entry ring, then each ring outwards; the wall ring last (finishing).
    moves.push(...pathMoves(entrySegs, z, z, feed));
    pos = entry;
    for (const segs of loops.slice(1)) {
      const at = nearestOnPath(segs, pos);
      const lap = loopFrom(segs, at);
      const start = lap[0]?.p0 ?? pos;
      if (Math.hypot(start.x - pos.x, start.y - pos.y) > EPS) {
        moves.push({ kind: 'linear', x: start.x, y: start.y, z, feed });
      }
      moves.push(...pathMoves(lap, z, z, feed));
      pos = start;
    }
    zPrev = z;
    segments.push({
      role: 'pass',
      pass,
      depth: z,
      ...(pass === last ? { final: true } : {}),
      moves,
    });
  });
  segments.push({ role: 'retract', moves: [{ kind: 'rapid', x: pos.x, y: pos.y, z: safeZ }] });
  return {
    ok: true,
    plungeEntry: !ramp,
    arcCollapsed: res.arcCollapsed,
    operation: {
      id: input.id,
      kind: 'pocket',
      sheet: input.sheet,
      partId: input.partId,
      copy: input.copy,
      inner: input.inner,
      tool: input.tool,
      toolDiameter: input.toolDiameter,
      rpm: input.rpm,
      feed: input.feed,
      plungeFeed: input.plungeFeed,
      travel: input.travel,
      passDepths: [...input.passDepths],
      tabs: [],
      segments,
    },
  };
}

/** A closed loop traversed backwards (arcs keep their shape: bulge negated). */
function reverseLoop(segs: readonly PathSeg[]): PathSeg[] {
  return [...segs].reverse().map((s) => ({ p0: s.p1, p1: s.p0, bulge: -s.bulge }));
}

/** Start point of a contour pocket (cut order): where its approach rapid goes. */
export function contourPocketStart(op: Operation): Point {
  const m = op.segments[0]?.moves[0];
  return { x: m?.x ?? 0, y: m?.y ?? 0 };
}
