/**
 * Hole geometry for the editor and the rules (T138, spec §4.5): the circle a hole takes out of the
 * part and whether it lies inside the part (inside the outline, clear of the cut-outs). Pure.
 */
import {
  EPS,
  arcOf,
  contour,
  forEachSegment,
  sampleSegment,
  type Point,
  type Vertex,
} from '../geometry';
import type { Hole } from '../schema/project';

/**
 * Outer radius of the material a hole removes, mm: pocket / through = d/2; a groove is a ring
 * around its centreline diameter d, so its outer edge is (d + grooveWidth)/2.
 */
export function holeOuterRadius(hole: Hole): number {
  return hole.type === 'groove' ? (hole.d + hole.grooveWidth) / 2 : hole.d / 2;
}

/** Shortest distance from `p` to one segment (line or arc), mm. */
export function segmentDistance(p: Point, a: Point, b: Point, bulge: number): number {
  const arc = arcOf(a, b, bulge);
  if (!arc) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  // On the arc's sweep the nearest point is radial; otherwise one of the end points.
  const ang = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  let rel = arc.sweep >= 0 ? ang - arc.startAngle : arc.startAngle - ang;
  rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ends = Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y));
  if (rel <= Math.abs(arc.sweep)) {
    return Math.min(
      ends,
      Math.abs(Math.hypot(p.x - arc.center.x, p.y - arc.center.y) - arc.radius),
    );
  }
  return ends;
}

/** Shortest distance from `p` to a closed contour, mm. */
export function contourDistance(p: Point, vs: readonly Vertex[]): number {
  let d = Number.POSITIVE_INFINITY;
  forEachSegment(contour(vs), (a, b, bulge) => {
    d = Math.min(d, segmentDistance(p, a, b, bulge));
  });
  return d;
}

/** Whether `p` lies inside a closed contour (arcs sampled finely; points on the edge are unsure). */
export function insideContour(p: Point, vs: readonly Vertex[]): boolean {
  const pts: Point[] = [];
  forEachSegment(contour(vs), (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, 64);
    pts.push(...s.slice(0, -1));
  });
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i] as Point;
    const pj = pts[j] as Point;
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

export type HolePlacementError = 'outside' | 'cutout';

/**
 * Whether a hole lies inside its part (spec §4.5 "delik parçanın içinde", T138): its whole circle
 * (`holeOuterRadius`) inside the outline and clear of every inner contour (a hole in a cut-out
 * would cut air and leave the part's edge broken). Touching an edge counts as outside. EPS slack.
 */
export function checkHolePlacement(
  outline: readonly Vertex[],
  inners: readonly (readonly Vertex[])[],
  hole: Hole,
): HolePlacementError | undefined {
  const c = { x: hole.cx, y: hole.cy };
  const r = holeOuterRadius(hole);
  if (!insideContour(c, outline) || contourDistance(c, outline) < r + EPS) return 'outside';
  for (const inner of inners) {
    if (insideContour(c, inner) || contourDistance(c, inner) < r + EPS) return 'cutout';
  }
  return undefined;
}

/**
 * A hole's tool problem (T275, T320, spec §4.5, D-050, D-099, D-108): the one rule the validation
 * (where the hole is drawn) and the toolpath (backstop) share, checked in this order:
 * - the tool number is not in the machine's tool table;
 * - pocket / through: the diameter is smaller than the tool (equal is a single plunge);
 * - groove: the groove is narrower than the tool;
 * - a drill only drills a hole of its own diameter (through or blind): a bigger hole or a groove
 *   needs a mill (helical / pocket), else the drill would be run sideways (D-108).
 * EPS slack: within 0.001 mm counts as equal. A tool without `type` is treated as a mill.
 */
export type HoleToolProblem =
  | { code: 'TOOL_NOT_IN_PROFILE' }
  | { code: 'HOLE_SMALLER_THAN_TOOL'; toolDiameter: number }
  | { code: 'GROOVE_NARROWER_THAN_TOOL'; toolDiameter: number }
  | { code: 'DRILL_SIZE_MISMATCH'; toolDiameter: number };

/** The tool fields the hole rule reads. */
export interface HoleRuleTool {
  number: number;
  diameter: number;
  type?: string;
}

export function holeToolProblem(
  hole: Hole,
  tools: readonly HoleRuleTool[],
): HoleToolProblem | null {
  const tool = tools.find((t) => t.number === hole.tool);
  if (!tool) return { code: 'TOOL_NOT_IN_PROFILE' };
  if (hole.type === 'groove') {
    if (hole.grooveWidth < tool.diameter - EPS) {
      return { code: 'GROOVE_NARROWER_THAN_TOOL', toolDiameter: tool.diameter };
    }
    return tool.type === 'drill'
      ? { code: 'DRILL_SIZE_MISMATCH', toolDiameter: tool.diameter }
      : null;
  }
  if (hole.d < tool.diameter - EPS) {
    return { code: 'HOLE_SMALLER_THAN_TOOL', toolDiameter: tool.diameter };
  }
  if (tool.type === 'drill' && Math.abs(hole.d - tool.diameter) > EPS) {
    return { code: 'DRILL_SIZE_MISMATCH', toolDiameter: tool.diameter };
  }
  return null;
}

/** Tool types that may cut a hole at all (a V bit or a ball end mill never gets one by default). */
const HOLE_TOOL_TYPES: ReadonlySet<string> = new Set(['drill', 'flatEndMill', 'compression']);

/**
 * Default tool of a new hole (T320, D-108): a drill of exactly the hole's diameter when the machine
 * has one (the hole's own `tool` is ignored); else `fallback` (the material set's tool) when it suits the hole; else the widest mill
 * that suits it (fewest rings); else `fallback` (the validation then names the problem).
 * Deterministic: ties go to the lower tool number.
 */
export function bestHoleTool(hole: Hole, tools: readonly HoleRuleTool[], fallback: number): number {
  const fits = (t: HoleRuleTool) =>
    (t.type === undefined || HOLE_TOOL_TYPES.has(t.type)) &&
    holeToolProblem({ ...hole, tool: t.number }, [t]) === null;
  const sorted = [...tools].sort((a, b) => a.number - b.number);
  const drill = sorted.find((t) => t.type === 'drill' && fits(t));
  if (drill) return drill.number;
  const own = sorted.find((t) => t.number === fallback);
  if (own && fits(own)) return fallback;
  const mills = sorted.filter((t) => t.type !== 'drill' && fits(t));
  const widest = mills.reduce<HoleRuleTool | undefined>(
    (best, t) => (best === undefined || t.diameter > best.diameter + EPS ? t : best),
    undefined,
  );
  return widest?.number ?? fallback;
}

/** A blind hole (pocket, groove) must stay above the sheet bottom: depth < thickness (EPS). */
export function blindDepthInvalid(hole: Hole, thickness: number): boolean {
  return hole.type !== 'through' && !(hole.depth < thickness - EPS);
}
