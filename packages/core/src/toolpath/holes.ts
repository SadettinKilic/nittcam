/**
 * Hole operations (T139–T140, spec §4.5, §6.3, D-050): drilling, circular pockets (through and
 * blind) and ring grooves, in the sheet frame. Kept apart from the contour builder.
 *
 * - d = tool diameter → `drill`: one plunge per pass depth (peck) at the plunge feed, each followed
 *   by a Z-only rapid back to the clearance height (what one G81 per peck does, D-050).
 * - d > tool → `pocket`: helical entry on the first ring, then concentric rings out to the wall
 *   (radius d/2 − tool radius), pass by pass. A through hole is cleared the same way, so it never
 *   leaves a loose slug (D-050); the wall sits at d/2.
 * - groove → `groove`: the tool centre follows the centreline circle (one ring when the width equals
 *   the tool diameter, else rings across the width), helical entry on the centreline.
 *
 * Every move that goes down is at the plunge feed; XY rapids only at safe Z; nothing below the
 * target depth.
 */
import { EPS } from '../geometry/constants';
import { bbox, contour, normalize } from '../geometry/polyline';
import { rotate, rotatePointBy } from '../geometry/transform';
import type { Point } from '../geometry/types';
import type { Hole, Part, Placement } from '../schema';
import { deriveOutline } from '../schema/outline';
import type { Move, MoveSegment, Operation, OperationKind } from './types';

export const HOLE_DEFAULTS = {
  /** Ring step of pocket and groove clearing as a fraction of the tool diameter. */
  stepoverFraction: 0.4,
  /** Helix angle of the entry against the XY plane, degrees. */
  helixAngleDeg: 3,
  /** Most helix turns per pass; a smaller ring descends more steeply (still at the plunge feed). */
  maxHelixTurns: 4,
  /** Below this ring radius the entry is a straight plunge (no helix), mm. */
  minHelixRadius: 0.5,
} as const;

/**
 * T358 (D-149): whether a hole of this kind can be entered on a helix at most `angleDeg` steep
 * (a kind without a straight plunge): a hole the cutter fills (`drill` kind: with a drill tool
 * it is pecked instead) or a ring below `minHelixRadius` has no helix. Otherwise the helix takes
 * as many turns as the angle needs (never steeper). Pure.
 */
export function holeHelixFits(hole: Hole, toolDiameter: number): boolean {
  if (holeOperationKind(hole, toolDiameter) === 'drill') return false;
  return holeEntryRadius(hole, toolDiameter) >= HOLE_DEFAULTS.minHelixRadius - EPS;
}

/** Radius of the ring the helix enters on (the first pocket ring, or the groove centreline). */
function holeEntryRadius(hole: Hole, toolDiameter: number): number {
  const radii =
    hole.type === 'groove'
      ? grooveRings(hole.d / 2, hole.grooveWidth, toolDiameter)
      : pocketRings(hole.d / 2 - toolDiameter / 2, toolDiameter);
  return radii[0] as number;
}

export type HoleOperationKind = Extract<OperationKind, 'drill' | 'pocket' | 'groove'>;

/** Which operation cuts a hole with a tool of `toolDiameter` (spec §4.5). */
export function holeOperationKind(hole: Hole, toolDiameter: number): HoleOperationKind {
  if (hole.type === 'groove') return 'groove';
  return hole.d <= toolDiameter + EPS ? 'drill' : 'pocket';
}

/**
 * Hole centre in the sheet frame, placed like `placedOutline` (D-019): rotated about the part's
 * local origin, then the rotated outline's bounding-box minimum moved to the placement.
 */
export function placedHoleCentre(
  part: Part,
  placement: Pick<Placement, 'x' | 'y' | 'rot'>,
  hole: Pick<Hole, 'cx' | 'cy'>,
): Point {
  const local = normalize(contour(deriveOutline(part)), 'outer');
  const box = bbox(rotate(local, placement.rot));
  const c = rotatePointBy({ x: hole.cx, y: hole.cy }, placement.rot);
  return { x: c.x + placement.x - box.minX, y: c.y + placement.y - box.minY };
}

export interface HoleOperationInput {
  id: string;
  sheet: number;
  partId: string;
  copy: number;
  hole: Hole;
  /** Centre in the sheet frame. */
  centre: Point;
  tool: number;
  toolDiameter: number;
  feed: number;
  plungeFeed: number;
  rpm: number;
  /** Pass depths (negative), last = the hole's target depth. */
  passDepths: number[];
  safeZ: number;
  clearanceZ: number;
  /** Climb inside a hole with a CW spindle = CCW travel (D-021). */
  travel: 'cw' | 'ccw';
  /**
   * T358: a kind without a straight plunge: the helix is at most this steep, with as many turns
   * as that takes (`holeHelixFits` refuses the hole first when it needs too many).
   */
  helix?: { angleDeg: number };
}

/** Ring radii of a pocket: first ring (≤ tool radius, so the centre is cut) out to `wall`. */
export function pocketRings(wall: number, toolDiameter: number): number[] {
  const step = HOLE_DEFAULTS.stepoverFraction * toolDiameter;
  const first = Math.min(wall, step);
  if (wall - first <= EPS) return [wall];
  const n = Math.max(1, Math.ceil((wall - first) / step - 1e-9));
  return [first, ...Array.from({ length: n }, (_, k) => first + ((wall - first) * (k + 1)) / n)];
}

/** Ring radii of a groove: one ring on the centreline, or rings across the width. */
export function grooveRings(centre: number, width: number, toolDiameter: number): number[] {
  const half = (width - toolDiameter) / 2;
  if (half <= EPS) return [centre];
  const step = HOLE_DEFAULTS.stepoverFraction * toolDiameter;
  const n = Math.max(1, Math.ceil((2 * half) / step - 1e-9));
  // Centreline first (the helix enters there), then outwards and inwards alternately.
  const radii = Array.from({ length: n + 1 }, (_, k) => centre - half + (2 * half * k) / n);
  return radii.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
}

export function buildHoleOperation(input: HoleOperationInput): Operation {
  const kind = holeOperationKind(input.hole, input.toolDiameter);
  const { centre: c, safeZ, clearanceZ, plungeFeed } = input;
  const segments: MoveSegment[] = [];
  const last = input.passDepths.length - 1;

  if (kind === 'drill') {
    segments.push({
      role: 'approach',
      moves: [
        { kind: 'rapid', x: c.x, y: c.y, z: safeZ },
        { kind: 'rapid', x: c.x, y: c.y, z: clearanceZ },
      ],
    });
    input.passDepths.forEach((z, pass) => {
      segments.push({
        role: 'pass',
        pass,
        depth: z,
        ...(pass === last ? { final: true } : {}),
        moves: [
          { kind: 'plunge', x: c.x, y: c.y, z, feed: plungeFeed },
          { kind: 'rapid', x: c.x, y: c.y, z: clearanceZ },
        ],
      });
    });
    segments.push({ role: 'retract', moves: [{ kind: 'rapid', x: c.x, y: c.y, z: safeZ }] });
    return operation(input, kind, segments);
  }

  const r = input.toolDiameter / 2;
  const radii =
    input.hole.type === 'groove'
      ? grooveRings(input.hole.d / 2, input.hole.grooveWidth, input.toolDiameter)
      : pocketRings(input.hole.d / 2 - r, input.toolDiameter);
  const entry = radii[0] as number;
  const ccw = input.travel === 'ccw';
  const at = (rr: number, z: number, side: 1 | -1 = 1): Point & { z: number } => ({
    x: c.x + side * rr,
    y: c.y,
    z,
  });
  const half = (rr: number, side: 1 | -1, z: number, feed: number): Move => ({
    kind: 'arc',
    ...at(rr, z, side),
    cx: c.x,
    cy: c.y,
    direction: ccw ? 'ccw' : 'cw',
    bulge: ccw ? 1 : -1,
    feed,
  });
  const circle = (rr: number, z: number): Move[] => [
    half(rr, -1, z, input.feed),
    half(rr, 1, z, input.feed),
  ];
  const helix = entry >= HOLE_DEFAULTS.minHelixRadius - EPS;
  const helixDeg = input.helix?.angleDeg ?? HOLE_DEFAULTS.helixAngleDeg;
  const maxTurns = input.helix ? Infinity : HOLE_DEFAULTS.maxHelixTurns;
  const pitchMax = 2 * Math.PI * entry * Math.tan((helixDeg * Math.PI) / 180);

  segments.push({
    role: 'approach',
    moves: [
      { kind: 'rapid', ...at(entry, safeZ) },
      { kind: 'rapid', ...at(entry, clearanceZ) },
      // Down to the material top at the plunge feed (still in the air).
      { kind: 'plunge', ...at(entry, 0), feed: plungeFeed },
    ],
  });
  let zPrev = 0;
  let pos = entry;
  input.passDepths.forEach((z, pass) => {
    const moves: Move[] = [];
    if (Math.abs(pos - entry) > EPS) {
      // Back to the entry ring through the area this pass already cleared.
      moves.push({ kind: 'linear', ...at(entry, zPrev), feed: input.feed });
    }
    if (helix) {
      const drop = zPrev - z;
      const turns = Math.min(
        maxTurns,
        Math.max(1, Math.ceil(drop / Math.max(pitchMax, EPS) - 1e-9)),
      );
      for (let k = 1; k <= 2 * turns; k++) {
        moves.push(half(entry, k % 2 === 1 ? -1 : 1, zPrev - (drop * k) / (2 * turns), plungeFeed));
      }
    } else {
      moves.push({ kind: 'plunge', ...at(entry, z), feed: plungeFeed });
    }
    // Flat bottom on the entry ring, then the rings outwards (or across the groove).
    moves.push(...circle(entry, z));
    for (const rr of radii.slice(1)) {
      moves.push({ kind: 'linear', ...at(rr, z), feed: input.feed });
      moves.push(...circle(rr, z));
    }
    pos = radii[radii.length - 1] as number;
    zPrev = z;
    segments.push({
      role: 'pass',
      pass,
      depth: z,
      ...(pass === last ? { final: true } : {}),
      moves,
    });
  });
  segments.push({ role: 'retract', moves: [{ kind: 'rapid', ...at(pos, safeZ) }] });
  return operation(input, kind, segments);
}

function operation(
  input: HoleOperationInput,
  kind: HoleOperationKind,
  segments: MoveSegment[],
): Operation {
  return {
    id: input.id,
    kind,
    sheet: input.sheet,
    partId: input.partId,
    copy: input.copy,
    holeId: input.hole.id,
    tool: input.tool,
    toolDiameter: input.toolDiameter,
    rpm: input.rpm,
    feed: input.feed,
    plungeFeed: input.plungeFeed,
    travel: input.travel,
    passDepths: [...input.passDepths],
    tabs: [],
    segments,
  };
}

/** Start point of a hole operation (cut order, D-023): where its approach rapid goes. */
export function holeStart(op: Operation): Point {
  const m = op.segments[0]?.moves[0];
  return { x: m?.x ?? 0, y: m?.y ?? 0 };
}
