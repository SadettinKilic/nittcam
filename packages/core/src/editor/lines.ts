/**
 * Open lines of a part (T142 on-line operations; T277): an engraved line must stay inside its
 * part, the tool radius included, or it cuts into the neighbour part. Shared by the validation
 * (where the line is drawn or imported) and the toolpath (backstop). Pure.
 */
import { EPS, arcOf, sampleSegment, type Point, type Vertex } from '../geometry';
import { contourDistance, insideContour } from './holes';

/** Sample spacing along a line, mm: a crossing between two samples stays within half of it. */
export const LINE_SAMPLE_MM = 0.25;

/** Points along an open line (bulge arcs followed), at most `LINE_SAMPLE_MM` apart. */
export function linePoints(vertices: readonly Vertex[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < vertices.length; i++) {
    const a = vertices[i] as Vertex;
    const b = vertices[i + 1] as Vertex;
    const arc = arcOf(a, b, a.bulge);
    const length = arc ? Math.abs(arc.sweep) * arc.radius : Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.min(20_000, Math.max(1, Math.ceil(length / LINE_SAMPLE_MM)));
    const pts = arc
      ? sampleSegment(a, b, a.bulge, steps)
      : Array.from({ length: steps + 1 }, (_, k) => ({
          x: a.x + ((b.x - a.x) * k) / steps,
          y: a.y + ((b.y - a.y) * k) / steps,
        }));
    out.push(...(i === 0 ? pts : pts.slice(1)));
  }
  return out;
}

/**
 * Whether an open line leaves its part (T277): some point of it lies outside the outline or
 * closer to it than `toolRadius` (the groove the tool cuts would reach past the edge). EPS slack.
 */
export function lineLeavesPart(
  outline: readonly Vertex[],
  line: readonly Vertex[],
  toolRadius: number,
): boolean {
  return linePoints(line).some(
    (p) => !insideContour(p, outline) || contourDistance(p, outline) < toolRadius - EPS,
  );
}

/** Default depth of a new on-line (engraving) operation, mm (T142). */
export const ONLINE_DEPTH = 1;

/**
 * Default on-line depth for a stock (T277): 1 mm, but on stock of 1 mm or less half the thickness,
 * so the default is never refused (an on-line depth must stay below the thickness).
 */
export function defaultOnlineDepth(thickness: number): number {
  if (thickness > ONLINE_DEPTH + EPS) return ONLINE_DEPTH;
  return Math.round((thickness / 2) * 1000) / 1000;
}
