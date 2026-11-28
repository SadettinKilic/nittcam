/**
 * Measure tool of the montaj tezgâhı (T389): point-to-point and face-to-face, a click snapping to
 * the nearest part corner (vertex) or contour edge within a tolerance. Pure, display only.
 */
import {
  boxCentre,
  dot,
  len,
  qRotate,
  scale,
  sub,
  add,
  type LocalBox,
  type Pose,
  type V3,
} from './assembly-math';

export interface MeasurePick {
  id: string;
  point: V3;
  kind: 'vertex' | 'edge' | 'face';
  /** World normal of the face clicked. */
  normal: V3;
}

export interface MeasureTarget {
  id: string;
  pose: Pose;
  box: LocalBox;
  /** Contour line segments in the local mesh frame (pairs of xyz points). */
  edges: ArrayLike<number>;
}

function closestOnSegment(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, t));
}

/** Snaps a clicked point: a contour corner within `tol` mm, else a contour edge, else the face. */
export function snapPick(target: MeasureTarget, hit: V3, normal: V3, tol: number): MeasurePick {
  const c = boxCentre(target.box);
  const w = (i: number): V3 => {
    const e = target.edges;
    const local: V3 = [(e[i] ?? 0) - c[0], (e[i + 1] ?? 0) - c[1], (e[i + 2] ?? 0) - c[2]];
    return add(target.pose.position, qRotate(target.pose.rotation, local));
  };
  let vBest = tol;
  let vertex: V3 | null = null;
  let eBest = tol;
  let edge: V3 | null = null;
  for (let i = 0; i + 5 < target.edges.length; i += 6) {
    const a = w(i);
    const b = w(i + 3);
    for (const p of [a, b]) {
      const d = len(sub(p, hit));
      if (d <= vBest) {
        vBest = d;
        vertex = p;
      }
    }
    const q = closestOnSegment(hit, a, b);
    const d = len(sub(q, hit));
    if (d <= eBest) {
      eBest = d;
      edge = q;
    }
  }
  const id = target.id;
  if (vertex) return { id, point: vertex, kind: 'vertex', normal };
  if (edge) return { id, point: edge, kind: 'edge', normal };
  return { id, point: hit, kind: 'face', normal };
}

export interface Measurement {
  distance: number;
  delta: V3;
  /** Both picks on parallel faces: the distance between the two face planes; else null. */
  faceGap: number | null;
}

export function measure(a: MeasurePick, b: MeasurePick): Measurement {
  const delta = sub(b.point, a.point);
  const parallel = Math.abs(dot(a.normal, b.normal)) > 0.999;
  return {
    distance: len(delta),
    delta,
    faceGap:
      a.kind === 'face' && b.kind === 'face' && parallel ? Math.abs(dot(delta, a.normal)) : null,
  };
}
