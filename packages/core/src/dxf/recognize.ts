/**
 * DXF part recognition (T145, spec §4.6 "Parça tanıma"): the outermost closed contour is a part,
 * closed contours inside it are its inner contours; a contour inside an inner contour is a part
 * again (an island, e.g. the dot inside a letter). Layer operations can force a role. Pure.
 */
import { EPS } from '../geometry/constants';
import { bbox, normalize, signedArea } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { BBox, Point, Polyline, Vertex } from '../geometry/types';
import { insidePolygon } from '../toolpath/lead';
import type { DxfContour, DxfJoinResult, DxfOpenChain } from './join';
import { layerOp, type DxfLayerMap, type DxfLayerOp } from './layers';
import { contourDistance, insideContour } from '../editor/holes';
import { GROOVE_EDGE_SLACK, linePoints } from '../editor/lines';

/** An inner contour of a recognised part (world mm, CW). */
export interface DxfInner {
  poly: Polyline;
  layer: string;
  /** Set for a full circle: a hole candidate (see `dxfCircleToHole`). */
  circle?: { cx: number; cy: number; d: number };
  /** True when its layer is mapped to `drill`. */
  drill: boolean;
}

/** A recognised part in drawing coordinates (mm): outline CCW, inners CW. */
export interface DxfPart {
  outline: Polyline;
  layer: string;
  inners: DxfInner[];
  /**
   * Contours and open chains on `online` ("Çizgi üzerinden") layers inside this part (T277), world
   * mm, as open polylines (a closed contour repeats its first point at the end).
   */
  lines: { poly: Polyline; layer: string; vgroove?: true }[];
  box: BBox;
}

export interface DxfRecognition {
  parts: DxfPart[];
  /** Chains that did not close: flagged, never imported. */
  open: DxfOpenChain[];
  /** Closed contours mapped to `inside`/`drill` that lie in no part. */
  orphans: DxfContour[];
  /** Contours on `pocket` layers: not imported yet (reported). */
  pending: DxfContour[];
  /** Lines on `online` layers that lie inside no part (T277): reported, not imported. */
  lineOrphans: { poly: Polyline; layer: string }[];
  /** Contours (and open chains) on `ignore` layers. */
  ignored: number;
}

interface Node {
  c: DxfContour;
  op: DxfLayerOp;
  area: number;
  box: BBox;
  ring: Point[];
  probe: Point;
  parent: number | undefined;
  role: 'part' | 'inner' | 'orphan';
}

/** A closed contour as an open line (T277): its first point repeated at the end. */
function closedAsOpen(poly: Polyline): Polyline {
  const vs = poly.vertices.map((v) => ({ x: v.x, y: v.y, bulge: v.bulge }));
  const first = vs[0];
  if (!poly.closed || !first) return { closed: false, vertices: vs };
  return { closed: false, vertices: [...vs, { x: first.x, y: first.y, bulge: 0 }] };
}

/** Polygon of a contour for point-in-polygon tests (arcs sampled). */
function ring(poly: Polyline): Point[] {
  const out: Point[] = [];
  const vs = poly.vertices;
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[i] as Vertex;
    const b = vs[(i + 1) % n] as Vertex;
    const pts = a.bulge === 0 ? [a] : sampleSegment(a, b, a.bulge, 32).slice(0, -1);
    out.push(...pts.map((p) => ({ x: p.x, y: p.y })));
  }
  return out;
}

/** A box shrunk by `d` on every side. */
function shrink(b: BBox, d: number): BBox {
  return { minX: b.minX + d, minY: b.minY + d, maxX: b.maxX - d, maxY: b.maxY - d };
}

function boxInside(inner: BBox, outer: BBox): boolean {
  return (
    inner.minX >= outer.minX - EPS &&
    inner.minY >= outer.minY - EPS &&
    inner.maxX <= outer.maxX + EPS &&
    inner.maxY <= outer.maxY + EPS
  );
}

/** Point used to test whether a contour lies inside another: the middle of its first segment. */
function probeOf(poly: Polyline): Point {
  const a = poly.vertices[0] as Vertex;
  const b = poly.vertices[1 % poly.vertices.length] as Vertex;
  const pts = sampleSegment(a, b, a.bulge, 2);
  return pts[1] ?? a;
}

/**
 * Builds parts from joined contours under a layer mapping (unmapped layers = `auto`).
 */
export function recognizeParts(
  joined: DxfJoinResult,
  map: Readonly<DxfLayerMap> = {},
): DxfRecognition {
  let ignored = 0;
  const pending: DxfContour[] = [];
  const online: { poly: Polyline; layer: string; vgroove?: true }[] = [];
  const nodes: Node[] = [];
  for (const c of joined.contours) {
    const op = layerOp(map, c.layer);
    if (op === 'ignore') {
      ignored += 1;
      continue;
    }
    if (op === 'pocket') {
      pending.push(c);
      continue;
    }
    if (op === 'online') {
      online.push({ poly: closedAsOpen(c.poly), layer: c.layer });
      continue;
    }
    if (op === 'vgroove') {
      online.push({ poly: closedAsOpen(c.poly), layer: c.layer, vgroove: true });
      continue;
    }
    const area = Math.abs(signedArea(c.poly));
    if (area <= EPS * EPS) continue;
    nodes.push({
      c,
      op,
      area,
      box: bbox(c.poly),
      ring: ring(c.poly),
      probe: probeOf(c.poly),
      parent: undefined,
      role: 'part',
    });
  }
  const open = joined.open.filter((o) => {
    const op = layerOp(map, o.layer);
    if (op === 'ignore') ignored += 1;
    // T277: an open chain on a "Çizgi üzerinden" layer is an engraving line, not an error.
    if (op === 'online') online.push({ poly: o.poly, layer: o.layer });
    if (op === 'vgroove') online.push({ poly: o.poly, layer: o.layer, vgroove: true });
    return op !== 'ignore' && op !== 'online' && op !== 'vgroove';
  });
  // Largest first, so every parent is decided before its children.
  const order = nodes
    .map((_, i) => i)
    .sort((a, b) => (nodes[b] as Node).area - (nodes[a] as Node).area || a - b);
  for (let k = 0; k < order.length; k++) {
    const node = nodes[order[k] as number] as Node;
    // Parent = the smallest larger contour that contains this one.
    for (let j = k - 1; j >= 0; j--) {
      const cand = nodes[order[j] as number] as Node;
      if (cand.area <= node.area) continue;
      if (boxInside(node.box, cand.box) && insidePolygon(node.probe, cand.ring)) {
        node.parent = order[j];
        break;
      }
    }
    const parent = node.parent === undefined ? undefined : (nodes[node.parent] as Node);
    if (node.op === 'outside') node.role = 'part';
    else if (node.op === 'inside' || node.op === 'drill')
      node.role = parent?.role === 'part' ? 'inner' : 'orphan';
    else node.role = parent?.role === 'part' ? 'inner' : 'part';
  }
  const parts: DxfPart[] = [];
  const partOf = new Map<number, DxfPart>();
  for (const idx of order) {
    const node = nodes[idx] as Node;
    if (node.role !== 'part') continue;
    const part: DxfPart = {
      outline: normalize(node.c.poly, 'outer'),
      layer: node.c.layer,
      inners: [],
      lines: [],
      box: node.box,
    };
    partOf.set(idx, part);
    parts.push(part);
  }
  const orphans: DxfContour[] = [];
  for (const idx of order) {
    const node = nodes[idx] as Node;
    if (node.role === 'orphan') orphans.push(node.c);
    if (node.role !== 'inner' || node.parent === undefined) continue;
    const owner = partOf.get(node.parent);
    if (!owner) continue;
    owner.inners.push({
      poly: normalize(node.c.poly, 'inner'),
      layer: node.c.layer,
      drill: node.op === 'drill',
      ...(node.c.circle ? { circle: node.c.circle } : {}),
    });
  }
  // T277: each line goes to the smallest part whose outline holds all of it; else it is reported.
  const lineOrphans: { poly: Polyline; layer: string }[] = [];
  const bySize = order.filter((i) => partOf.has(i)).reverse();
  for (const line of online) {
    const box = bbox(line.poly);
    const pts = linePoints(line.poly.vertices);
    const owner = bySize.find((i) => {
      const node = nodes[i] as Node;
      const vs = node.c.poly.vertices;
      // T352: a fold line may end on the outline (edge to edge).
      const near = (p: Point) =>
        line.vgroove === true && contourDistance(p, vs) <= GROOVE_EDGE_SLACK;
      const slack = line.vgroove === true ? GROOVE_EDGE_SLACK : 0;
      return (
        boxInside(shrink(box, slack), node.box) && pts.every((p) => insideContour(p, vs) || near(p))
      );
    });
    const part = owner === undefined ? undefined : partOf.get(owner);
    if (part) part.lines.push(line);
    else lineOrphans.push(line);
  }
  // Report order: left to right, then bottom to top (stable, independent of file order).
  parts.sort((a, b) => a.box.minX - b.box.minX || a.box.minY - b.box.minY);
  return { parts, open, orphans, pending, lineOrphans, ignored };
}
