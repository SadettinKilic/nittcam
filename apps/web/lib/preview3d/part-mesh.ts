/**
 * Part geometry for the 3D preview (T153, spec §3.8, §4.5, D-033). A pure builder: project data
 * in, plain typed arrays out (positions, normals, indices, edge lines). No CSG: the outline is
 * extruded to the stock thickness, inner contours and through holes are holes in the faces,
 * blind pockets and ring grooves are recessed geometry (wall + floor) cut into the top face.
 * Arcs are tessellated for display only. Only the lazy 3D scene imports this module (it uses
 * the triangulator of `three`).
 *
 * Frame: the part's local frame (mm, the frame of `deriveOutline`, Z = 0 the sheet bottom,
 * Z = thickness the material top). Placement transforms move it into the sheet frame.
 */
import {
  contour,
  innerOperation,
  deriveOutline,
  normalize,
  placedOutline,
  rotate,
  type Hole,
  type Part,
  type Placement,
} from '@nittcam/core';
import { ShapeUtils, Vector2 } from 'three';
import { flatten, flattenOpen } from './outlines';
import { MIN_FLOOR } from './min-floor';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** Per vertex: 1 on an edge-banded wall (spec §4.8, coloured in 3D, T154), else 0. */
  bands: Float32Array;
  indices: Uint32Array;
  /** Line segments (pairs of points) along the visible contours (technical-drawing edges). */
  edges: Float32Array;
  /** Openings in the top face: inner contours + holes of every type (for tests and stats). */
  openings: number;
  /** Through openings (visible from below): inner contours + through holes. */
  throughOpenings: number;
}

export { MIN_FLOOR };
/** Adjacent wall facets closer than this turn smoothly (arcs, circles); sharper = hard edge. */
const SMOOTH_DEG = 35;

/** Number of facets of a circle of radius `r` mm (display only). */
export function circleSegments(r: number): number {
  return Math.max(16, Math.min(64, Math.round(r * 1.5)));
}

/** A circle as flat [x, y, …], clockwise (hole direction, spec §6.1) unless `ccw`. */
export function circle(cx: number, cy: number, r: number, ccw = false): number[] {
  const n = circleSegments(r);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((ccw ? i : -i) / n) * Math.PI * 2;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Signed area of a flat ring (> 0 = CCW). */
export function ringArea(flat: readonly number[]): number {
  let a = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += at(flat, 2 * i) * at(flat, 2 * j + 1) - at(flat, 2 * j) * at(flat, 2 * i + 1);
  }
  return a / 2;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  band: number[] = [];
  idx: number[] = [];
  edges: number[] = [];

  /** A horizontal face at `z` (normal +Z when `up`), outer ring CCW-or-not, holes any direction. */
  face(outer: number[], holes: number[][], z: number, up: boolean) {
    const o = toVecs(outer);
    const hs = holes.map(toVecs);
    const tris = ShapeUtils.triangulateShape(o, hs);
    const all = [o, ...hs].flat();
    const base = this.pos.length / 3;
    for (const v of all) {
      this.pos.push(v.x, v.y, z);
      this.nor.push(0, 0, up ? 1 : -1);
      this.band.push(0);
    }
    for (const t of tris) {
      const [a, b, c] = t as [number, number, number];
      const pa = all[a];
      const pb = all[b];
      const pc = all[c];
      if (!pa || !pb || !pc) continue;
      const ccw = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) > 0;
      // Front faces are CCW seen from the side the normal points to.
      if (ccw === up) this.idx.push(base + a, base + b, base + c);
      else this.idx.push(base + a, base + c, base + b);
    }
  }

  /**
   * A vertical wall along a closed ring from `z0` to `z1`. The normal points to the right of
   * travel, i.e. out of the material for a CCW outer ring and a CW hole ring (spec §6.1).
   */
  wall(ring: number[], z0: number, z1: number, banded?: (nx: number, ny: number) => boolean) {
    const n = ring.length / 2;
    if (n < 2 || z1 - z0 <= 0) return;
    const en: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = at(ring, 2 * j) - at(ring, 2 * i);
      const dy = at(ring, 2 * j + 1) - at(ring, 2 * i + 1);
      const l = Math.hypot(dx, dy) || 1;
      en.push([dy / l, -dx / l]);
    }
    const cosSmooth = Math.cos((SMOOTH_DEG * Math.PI) / 180);
    // Normal at vertex i seen from edge e (e = i - 1 or i): smooth when the turn is gentle.
    const vertexNormal = (i: number, e: number): [number, number] => {
      const prev = en[(i - 1 + n) % n] ?? [0, 0];
      const next = en[i] ?? [0, 0];
      if (prev[0] * next[0] + prev[1] * next[1] >= cosSmooth) {
        const x = prev[0] + next[0];
        const y = prev[1] + next[1];
        const l = Math.hypot(x, y) || 1;
        return [x / l, y / l];
      }
      return en[(e + n) % n] ?? [0, 0];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = at(ring, 2 * i);
      const ay = at(ring, 2 * i + 1);
      const bx = at(ring, 2 * j);
      const by = at(ring, 2 * j + 1);
      const na = vertexNormal(i, i);
      const nb = vertexNormal(j, i);
      const base = this.pos.length / 3;
      this.pos.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1);
      this.nor.push(na[0], na[1], 0, nb[0], nb[1], 0, nb[0], nb[1], 0, na[0], na[1], 0);
      const e = en[i] ?? [0, 0];
      const f = banded?.(e[0], e[1]) ? 1 : 0;
      this.band.push(f, f, f, f);
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Open chain of edge lines at height `z`. */
  polyline(flat: number[], z: number) {
    for (let i = 0; i + 3 < flat.length; i += 2)
      this.edges.push(at(flat, i), at(flat, i + 1), z, at(flat, i + 2), at(flat, i + 3), z);
  }

  /** Closed loop of edge lines at height `z`. */
  loop(ring: number[], z: number) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.edges.push(
        at(ring, 2 * i),
        at(ring, 2 * i + 1),
        z,
        at(ring, 2 * j),
        at(ring, 2 * j + 1),
        z,
      );
    }
  }

  done(openings: number, throughOpenings: number): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      bands: new Float32Array(this.band),
      indices: new Uint32Array(this.idx),
      edges: new Float32Array(this.edges),
      openings,
      throughOpenings,
    };
  }
}

/** Outline of a part in its local frame (CCW, arcs tessellated). */
export function localOutline(part: Part): number[] {
  return flatten(normalize(contour(deriveOutline(part)), 'outer'));
}

/** Blind depth of a hole clamped to the stock; null = drawn as through. */
function blindDepth(hole: Hole, thickness: number): number | null {
  if (hole.type === 'through') return null;
  return hole.depth >= thickness - MIN_FLOOR ? null : hole.depth;
}

/**
 * The mesh of one part extruded to `thickness` (T153): outline walls and faces, inner contours
 * and through holes as openings through both faces, blind pockets as a cylinder wall + floor,
 * ring grooves as two walls + an annular floor (spec §4.5). A pocket or groove at least as deep
 * as the stock is drawn as through.
 */
export function partMesh(part: Part, thickness: number): MeshData {
  const T = thickness;
  const b = new Builder();
  const outline = localOutline(part);
  // T142 operations: only cut inner contours (`inside`) open the part; `online` ones and open
  // lines are engraved marks on the top face (drawn as lines; a recessed groove needs the tool
  // width, B20); `none` is not cut at all.
  const inners: number[][] = [];
  // T325: blind contour pockets, a wall down to the floor and the floor face.
  const pockets: { ring: number[]; floorRing: number[]; floor: number }[] = [];
  part.inners.forEach((c, k) => {
    const op = innerOperation(part, k);
    const ring = flatten(normalize(contour(c), 'inner'));
    if (op.kind === 'pocket' && op.depth < T - MIN_FLOOR) {
      pockets.push({
        ring,
        floorRing: flatten(normalize(contour(c), 'outer')),
        floor: T - op.depth,
      });
    } else if (op.kind === 'inside' || op.kind === 'outside' || op.kind === 'pocket') {
      inners.push(ring);
    } else if (op.kind === 'online') b.loop(ring, T);
  });
  for (const line of part.lines ?? []) {
    if (line.op.kind === 'online') b.polyline(flattenOpen(line.vertices), T);
  }

  const topHoles: number[][] = [...inners];
  const bottomHoles: number[][] = [...inners];
  let through = inners.length;
  for (const ring of inners) {
    b.wall(ring, 0, T);
    b.loop(ring, T);
  }
  for (const p of pockets) {
    topHoles.push(p.ring);
    b.wall(p.ring, p.floor, T);
    b.loop(p.ring, T);
    b.face(p.floorRing, [], p.floor, true);
  }
  for (const hole of part.holes) {
    const depth = blindDepth(hole, T);
    const floor = depth === null ? 0 : T - depth;
    if (hole.type === 'groove') {
      const ro = (hole.d + hole.grooveWidth) / 2;
      const ri = (hole.d - hole.grooveWidth) / 2;
      const outer = circle(hole.cx, hole.cy, ro);
      const island = circle(hole.cx, hole.cy, ri, true);
      topHoles.push(outer);
      b.face(island, [], T, true);
      b.wall(outer, floor, T);
      b.wall(island, floor, T);
      b.loop(outer, T);
      b.loop(island, T);
      if (depth === null) {
        bottomHoles.push(outer);
        b.face(island, [], 0, false);
        through++;
      } else
        b.face(circle(hole.cx, hole.cy, ro, true), [circle(hole.cx, hole.cy, ri)], floor, true);
      continue;
    }
    const ring = circle(hole.cx, hole.cy, hole.d / 2);
    topHoles.push(ring);
    b.wall(ring, floor, T);
    b.loop(ring, T);
    if (depth === null) {
      bottomHoles.push(ring);
      through++;
    } else b.face(circle(hole.cx, hole.cy, hole.d / 2, true), [], floor, true);
  }

  b.face(outline, topHoles, T, true);
  b.face(outline, bottomHoles, 0, false);
  b.wall(outline, 0, T, bandedSide(part));
  b.loop(outline, T);
  b.loop(outline, 0);
  return b.done(inners.length + pockets.length + part.holes.length, through);
}

/** Placement transform of a part: sheet = R(rot) · local + (tx, ty) (CCW degrees, spec §6.1). */
export interface PlacementTransform {
  rot: number;
  tx: number;
  ty: number;
}

/**
 * Transform that moves the local mesh onto its placement: the same rotation and shift as core
 * `placedOutline` (rotate about the local origin, then move the rotated bounding box to x, y).
 */
export function placementTransform(
  part: Part,
  placement: Pick<Placement, 'x' | 'y' | 'rot'>,
): PlacementTransform {
  const local = normalize(contour(deriveOutline(part)), 'outer');
  const turned = rotate(local, placement.rot).vertices[0];
  const placed = placedOutline(part, placement).vertices[0];
  if (!turned || !placed) return { rot: placement.rot, tx: placement.x, ty: placement.y };
  return { rot: placement.rot, tx: placed.x - turned.x, ty: placed.y - turned.y };
}

/** Applies a placement transform to a local point. */
export function applyTransform(t: PlacementTransform, x: number, y: number): [number, number] {
  const r = (t.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c - y * s + t.tx, x * s + y * c + t.ty];
}

/**
 * Cache key of a part's shape: parts (and copies) with the same outline, inner contours, holes
 * and thickness share one geometry (instancing). Ids, names, tools and grain do not matter.
 */
export function shapeKey(part: Part, thickness: number): string {
  const holes = part.holes.map((h) =>
    h.type === 'groove'
      ? ['g', h.d, h.cx, h.cy, h.depth, h.grooveWidth]
      : h.type === 'pocket'
        ? ['p', h.d, h.cx, h.cy, h.depth]
        : ['t', h.d, h.cx, h.cy],
  );
  const band = part.kind === 'rect' ? part.edgeBand : null;
  return JSON.stringify([
    thickness,
    deriveOutline(part),
    part.inners,
    holes,
    band,
    part.ops ?? null,
    part.lines ?? null,
  ]);
}

function toVecs(flat: readonly number[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(new Vector2(at(flat, i), at(flat, i + 1)));
  return out;
}

function at(a: ArrayLike<number>, i: number): number {
  return a[i] ?? 0;
}

/**
 * The waste of a sheet (T153): the sheet slab with an opening at every placed part outline, so a
 * lifted or hidden part (T155) leaves its cut-out. `outlines` are in the sheet frame (CCW).
 */
export function wasteMesh(
  sheet: { width: number; height: number },
  thickness: number,
  outlines: readonly number[][],
): MeshData {
  const b = new Builder();
  const { width: W, height: H } = sheet;
  const rect = [0, 0, W, 0, W, H, 0, H];
  const holes = outlines.map(reverseRing);
  b.face(rect, holes, thickness, true);
  b.face(rect, holes, 0, false);
  b.wall(rect, 0, thickness);
  for (const h of holes) b.wall(h, 0, thickness);
  b.loop(rect, thickness);
  b.loop(rect, 0);
  return b.done(holes.length, holes.length);
}

/** A flat ring in the opposite direction. */
export function reverseRing(flat: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = flat.length - 2; i >= 0; i -= 2) out.push(at(flat, i), at(flat, i + 1));
  return out;
}

/**
 * Edge band test of a rectangle's outline wall by its outward normal (spec §4.8): the band
 * sides top/right/bottom/left are the sides of the rectangle in its own frame (Y up). Rounded
 * corners stay unbanded. Freeform parts have no named sides: none.
 */
function bandedSide(part: Part): ((nx: number, ny: number) => boolean) | undefined {
  if (part.kind !== 'rect') return undefined;
  const eb = part.edgeBand;
  if (eb.top <= 0 && eb.right <= 0 && eb.bottom <= 0 && eb.left <= 0) return undefined;
  const axis = 0.999;
  return (nx, ny) =>
    (ny > axis && eb.top > 0) ||
    (nx > axis && eb.right > 0) ||
    (ny < -axis && eb.bottom > 0) ||
    (nx < -axis && eb.left > 0);
}
