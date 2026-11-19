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
  box: BBox;
}

export interface DxfRecognition {
  parts: DxfPart[];
  /** Chains that did not close: flagged, never imported. */
  open: DxfOpenChain[];
  /** Closed contours mapped to `inside`/`drill` that lie in no part. */
  orphans: DxfContour[];
  /** Contours on `pocket` / `online` layers: waiting for T142, not imported. */
  pending: DxfContour[];
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
  const nodes: Node[] = [];
  for (const c of joined.contours) {
    const op = layerOp(map, c.layer);
    if (op === 'ignore') {
      ignored += 1;
      continue;
    }
    if (op === 'pocket' || op === 'online') {
      pending.push(c);
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
    const skip = layerOp(map, o.layer) === 'ignore';
    if (skip) ignored += 1;
    return !skip;
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
  // Report order: left to right, then bottom to top (stable, independent of file order).
  parts.sort((a, b) => a.box.minX - b.box.minX || a.box.minY - b.box.minY);
  return { parts, open, orphans, pending, ignored };
}
