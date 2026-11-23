/**
 * DXF join (T145, spec §4.6 "Birleştirme"): open pieces whose ends lie within JOIN_TOL become
 * chains; a chain whose ends meet becomes a closed contour. Exact duplicates (dirty files) are
 * dropped first. Pieces join only within their own layer, so a layer → operation mapping keeps
 * meaning. Deterministic: input order decides ties. Pure.
 */
import { EPS, JOIN_TOL } from '../geometry/constants';
import { reverse } from '../geometry/polyline';
import { isArc } from '../geometry/segment';
import type { Point, Polyline, Vertex } from '../geometry/types';
import { distToSegment } from './curves';
import type { DxfPath } from './types';

/** A closed contour after joining. */
export interface DxfContour {
  layer: string;
  poly: Polyline;
  /** Full circle (unchanged CIRCLE / circular ELLIPSE): centre and diameter, mm. */
  circle?: { cx: number; cy: number; d: number };
  /** How many DXF pieces went into it. */
  pieces: number;
}

/** A chain that did not close ("Kapanmayanlar işaretlenir"). */
export interface DxfOpenChain {
  layer: string;
  poly: Polyline;
  pieces: number;
}

export interface DxfJoinResult {
  contours: DxfContour[];
  open: DxfOpenChain[];
  /** Pieces dropped as exact duplicates of an earlier piece. */
  duplicates: number;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Key of a polyline independent of direction (and, when closed, of the start vertex). */
function shapeKey(poly: Polyline): string {
  const fmt = (vs: readonly Vertex[], closed: boolean) =>
    vs
      .map((v, i) => {
        const b = closed || i < vs.length - 1 ? v.bulge : 0;
        return `${Math.round(v.x / EPS)},${Math.round(v.y / EPS)},${Math.round(b * 1e6)}`;
      })
      .join(';');
  const rotations = (p: Polyline): string[] => {
    if (!p.closed) return [fmt(p.vertices, false)];
    const n = p.vertices.length;
    return p.vertices.map((_, s) =>
      fmt(
        Array.from({ length: n }, (_, k) => p.vertices[(s + k) % n] as Vertex),
        true,
      ),
    );
  };
  const all = [...rotations(poly), ...rotations(reverse(poly))];
  return `${poly.closed ? 'C' : 'O'}|${all.sort()[0] ?? ''}`;
}

/** Spatial hash of chain ends for quick "which end is near" queries. */
class EndGrid {
  private cells = new Map<string, number[]>();
  constructor(private readonly size: number) {}
  private key(cx: number, cy: number) {
    return `${cx},${cy}`;
  }
  add(p: Point, id: number) {
    const k = this.key(Math.floor(p.x / this.size), Math.floor(p.y / this.size));
    const list = this.cells.get(k);
    if (list) list.push(id);
    else this.cells.set(k, [id]);
  }
  near(p: Point): number[] {
    const cx = Math.floor(p.x / this.size);
    const cy = Math.floor(p.y / this.size);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(this.key(cx + dx, cy + dy));
        if (list) out.push(...list);
      }
    }
    return out;
  }
}

/**
 * Circle marker of a closed polyline drawn as two half arcs (how many CAD and sign programs write
 * a circle as a polyline); undefined for any other shape.
 */
export function circleOf(poly: Polyline): { cx: number; cy: number; d: number } | undefined {
  const [a, b] = poly.vertices;
  if (!poly.closed || poly.vertices.length !== 2 || !a || !b) return undefined;
  if (Math.abs(Math.abs(a.bulge) - 1) > 1e-9 || Math.abs(b.bulge - a.bulge) > 1e-9)
    return undefined;
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: dist(a, b) };
}

/** True when a closed polyline with these vertices encloses an area worth cutting. */
function canClose(vs: readonly Vertex[]): boolean {
  if (vs.length >= 3) return true;
  if (vs.length !== 2) return false;
  const [a, b] = vs as [Vertex, Vertex];
  return isArc(a, b, a.bulge) || isArc(b, a, b.bulge);
}

/** True when a single straight piece lies on a straight edge of one of the closed polylines. */
function onClosedEdge(line: Polyline, closed: readonly Polyline[], tol: number): boolean {
  const [p, q] = line.vertices;
  if (line.vertices.length !== 2 || !p || !q || Math.abs(p.bulge) > 1e-12) return false;
  return closed.some((c) =>
    c.vertices.some((a, i) => {
      const b = c.vertices[(i + 1) % c.vertices.length] as Vertex;
      return (
        Math.abs(a.bulge) <= 1e-12 && distToSegment(p, a, b) <= tol && distToSegment(q, a, b) <= tol
      );
    }),
  );
}

/**
 * B53 (tester B16): a LINE drawn over an edge of a closed polyline on the same layer is a
 * duplicate too (a dirty file that outlines a part twice), not a flagged open chain. Only when it
 * stands alone: a piece whose end meets another open piece (not itself such a line) is kept, so a
 * part drawn from LINEs that shares an edge with a closed neighbour still closes.
 */
function dropEdgeLines(
  pieces: readonly Polyline[],
  closed: readonly Polyline[],
  tol: number,
): { kept: Polyline[]; dropped: number } {
  if (closed.length === 0) return { kept: [...pieces], dropped: 0 };
  const onEdge = pieces.map((p) => onClosedEdge(p, closed, tol));
  const ends: Point[] = [];
  pieces.forEach((p, i) => {
    if (onEdge[i] || p.vertices.length === 0) return;
    ends.push(p.vertices[0] as Point, p.vertices[p.vertices.length - 1] as Point);
  });
  const touches = (pt: Point) => ends.some((e) => dist(e, pt) <= tol);
  const kept: Polyline[] = [];
  let dropped = 0;
  pieces.forEach((p, i) => {
    // onEdge pieces are two-vertex lines; others keep their place whatever they are.
    const a = p.vertices[0];
    const b = p.vertices[p.vertices.length - 1];
    if (onEdge[i] && a && b && !touches(a) && !touches(b)) dropped += 1;
    else kept.push(p);
  });
  return { kept, dropped };
}

/**
 * Joins open pieces into closed contours. Closed pieces pass through; duplicates are dropped.
 * `tol` is the join tolerance in mm (default JOIN_TOL, spec §4.6).
 */
export function joinPaths(paths: readonly DxfPath[], tol: number = JOIN_TOL): DxfJoinResult {
  const contours: DxfContour[] = [];
  const open: DxfOpenChain[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  const byLayer = new Map<string, Polyline[]>();
  for (const p of paths) {
    const key = `${p.layer}|${shapeKey(p.poly)}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    if (p.poly.closed) {
      const circle = p.circle ?? circleOf(p.poly);
      contours.push({ layer: p.layer, poly: p.poly, pieces: 1, ...(circle ? { circle } : {}) });
      continue;
    }
    const list = byLayer.get(p.layer);
    if (list) list.push(p.poly);
    else byLayer.set(p.layer, [p.poly]);
  }
  for (const [layer, all] of byLayer) {
    const closed = contours.filter((c) => c.layer === layer).map((c) => c.poly);
    const { kept: pieces, dropped } = dropEdgeLines(all, closed, tol);
    duplicates += dropped;
    const result = joinLayer(pieces, tol);
    for (const c of result.closed) {
      const circle = circleOf(c.poly);
      contours.push({ layer, poly: c.poly, pieces: c.pieces, ...(circle ? { circle } : {}) });
    }
    for (const c of result.open) open.push({ layer, poly: c.poly, pieces: c.pieces });
  }
  return { contours, open, duplicates };
}

interface Chain {
  poly: Polyline;
  pieces: number;
}

function joinLayer(pieces: readonly Polyline[], tol: number): { closed: Chain[]; open: Chain[] } {
  // Ends: id = 2·piece + (0 = start, 1 = end).
  const grid = new EndGrid(Math.max(tol, EPS));
  const endPoint = (id: number): Point => {
    const poly = pieces[id >> 1] as Polyline;
    return (id & 1 ? poly.vertices[poly.vertices.length - 1] : poly.vertices[0]) as Vertex;
  };
  pieces.forEach((_, i) => {
    grid.add(endPoint(2 * i), 2 * i);
    grid.add(endPoint(2 * i + 1), 2 * i + 1);
  });
  const used = pieces.map(() => false);
  /** Nearest unused end within tol of p (ties: lower id). */
  const nearest = (p: Point): number | undefined => {
    let best: number | undefined;
    let bestD = Infinity;
    for (const id of grid.near(p).sort((a, b) => a - b)) {
      if (used[id >> 1]) continue;
      const d = dist(p, endPoint(id));
      if (d <= tol && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  };
  const closed: Chain[] = [];
  const openChains: Chain[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const vs: Vertex[] = (pieces[i] as Polyline).vertices.map((v) => ({ ...v }));
    let count = 1;
    const isClosedNow = () =>
      vs.length >= 2 &&
      dist(vs[0] as Vertex, vs[vs.length - 1] as Vertex) <= tol &&
      canClose(vs.slice(0, -1));
    // Grow at the end.
    while (!isClosedNow()) {
      const tail = vs[vs.length - 1] as Vertex;
      const id = nearest(tail);
      if (id === undefined) break;
      used[id >> 1] = true;
      count += 1;
      const piece = pieces[id >> 1] as Polyline;
      const oriented = id & 1 ? reverse(piece) : piece;
      tail.bulge = (oriented.vertices[0] as Vertex).bulge;
      for (const v of oriented.vertices.slice(1)) vs.push({ ...v });
    }
    // Grow at the start.
    while (!isClosedNow()) {
      const head = vs[0] as Vertex;
      const id = nearest(head);
      if (id === undefined) break;
      used[id >> 1] = true;
      count += 1;
      const piece = pieces[id >> 1] as Polyline;
      // The piece must end at the head: reverse it when its start is the matching end.
      const oriented = id & 1 ? piece : reverse(piece);
      const before = oriented.vertices.slice(0, -1).map((v) => ({ ...v }));
      vs.unshift(...before);
    }
    const last = vs[vs.length - 1] as Vertex;
    last.bulge = 0;
    if (isClosedNow()) {
      vs.pop();
      closed.push({ poly: { vertices: vs, closed: true }, pieces: count });
    } else {
      openChains.push({ poly: { vertices: vs, closed: false }, pieces: count });
    }
  }
  return { closed, open: openChains };
}
