/**
 * Templates (T147–T149, spec §4.7): a parametric group of holes, inner contours and lines, saved
 * from a part and placed on parts as a copy. Pure: no clock, randomness or I/O.
 *
 * Frame: a template lives in its own frame (local +x points into the part away from the
 * reference edge, local +y runs along it, origin = reference point). Placing it maps a local
 * point p of copy k (0 ≤ k < count) to the part frame by
 *   p + (0, (k − (count − 1) / 2) · spacing)  →  mirror (y → −y)  →  rotate `rot`  →  + origin,
 * where the origin keeps `edgeDistance` from the anchored edge.
 */
import { tidy } from '../editor/draw';
import { localBox } from '../editor/board';
import { normalizeInner } from '../editor/inners';
import { contour } from '../geometry/polyline';
import { mirror, rotate, rotatePointBy, translate } from '../geometry/transform';
import type { BBox, Point, Polyline } from '../geometry/types';
import { innerOperation } from '../schema/operations';
import type {
  Hole,
  Part,
  TemplateContourOp,
  TemplateEdge,
  TemplateGeometry,
  TemplateParams,
  TemplatePlacement,
  TemplateRef,
  Vertex,
} from '../schema';

/** Rotation that turns local +x into the inward normal of `edge`. */
export const EDGE_ROTATION: Readonly<Record<TemplateEdge, number>> = {
  left: 0,
  bottom: 90,
  right: 180,
  top: 270,
};

/** Separator of generated hole ids: `<instanceId>/<template hole id>/<copy number>`. */
const SEP = '/';

/** Prefix of every hole id a template instance creates. */
export function instanceHolePrefix(instanceId: string): string {
  return `${instanceId}${SEP}`;
}

/** Normalises degrees to [0, 360) with 3 decimals, like placement rotations (D-034). */
export function normalizeTemplateRot(deg: number): number {
  const r = Math.round((((deg % 360) + 360) % 360) * 1000) / 1000;
  return r >= 360 || r === 0 ? 0 : r;
}

/** The origin after the edge anchor: the coordinate across the edge follows `edgeDistance`. */
export function anchoredOrigin(
  placement: TemplatePlacement,
  edgeDistance: number,
  box: BBox,
): Point {
  const { x, y } = placement;
  switch (placement.edge) {
    case 'left':
      return { x: tidy(box.minX + edgeDistance), y };
    case 'right':
      return { x: tidy(box.maxX - edgeDistance), y };
    case 'bottom':
      return { x, y: tidy(box.minY + edgeDistance) };
    case 'top':
      return { x, y: tidy(box.maxY - edgeDistance) };
    default:
      return { x, y };
  }
}

/** Offsets (local y) of the `count` copies, centred on the origin. */
export function copyOffsets(params: Pick<TemplateParams, 'count' | 'spacing'>): number[] {
  const n = params.count;
  return Array.from({ length: n }, (_, k) => tidy((k - (n - 1) / 2) * params.spacing));
}

function mapPoint(p: Point, dy: number, pl: TemplatePlacement, o: Point): Point {
  const m = { x: p.x, y: pl.mirror ? -(p.y + dy) : p.y + dy };
  const r = rotatePointBy(m, pl.rot);
  return { x: tidy(r.x + o.x), y: tidy(r.y + o.y) };
}

function mapPoly(poly: Polyline, dy: number, pl: TemplatePlacement, o: Point): Polyline {
  let out = translate(poly, 0, dy);
  if (pl.mirror) out = mirror(out, 'y');
  if (pl.rot) out = rotate(out, pl.rot);
  out = translate(out, o.x, o.y);
  return {
    closed: out.closed,
    vertices: out.vertices.map((v) => ({ x: tidy(v.x), y: tidy(v.y), bulge: v.bulge })),
  };
}

/** What an instance adds to its part, in the part frame. */
export interface DerivedTemplate {
  holes: Hole[];
  /** Stored CW, like every inner contour (spec §6.1). */
  inners: { contour: Vertex[]; op?: TemplateContourOp }[];
  lines: { vertices: Vertex[]; op: TemplateContourOp }[];
}

/** The holes, inner contours and lines of an instance on a part with local box `box`. */
export function deriveTemplate(
  ref: Pick<TemplateRef, 'instanceId' | 'geometry' | 'params' | 'placement'>,
  box: BBox,
): DerivedTemplate {
  const { geometry: g, params, placement } = ref;
  const o = anchoredOrigin(placement, params.edgeDistance, box);
  const out: DerivedTemplate = { holes: [], inners: [], lines: [] };
  copyOffsets(params).forEach((dy, k) => {
    for (const h of g.holes) {
      const c = mapPoint({ x: h.cx, y: h.cy }, dy, placement, o);
      out.holes.push({
        ...h,
        id: `${ref.instanceId}${SEP}${h.id}${SEP}${k + 1}`,
        d: params.d[h.id] ?? h.d,
        cx: c.x,
        cy: c.y,
      });
    }
    for (const inner of g.inners) {
      const vs = mapPoly(contour(inner.contour.map((v) => ({ ...v }))), dy, placement, o);
      out.inners.push({
        contour: normalizeInner(vs.vertices),
        ...(inner.op ? { op: inner.op } : {}),
      });
    }
    for (const line of g.lines ?? []) {
      const poly: Polyline = { closed: false, vertices: line.vertices.map((v) => ({ ...v })) };
      out.lines.push({ vertices: mapPoly(poly, dy, placement, o).vertices, op: line.op });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Writing an instance into a part (used by the template commands on an Immer draft)
// ---------------------------------------------------------------------------

const sameVertices = (a: readonly Vertex[], b: readonly Vertex[]) =>
  a.length === b.length &&
  a.every((v, i) => v.x === b[i]?.x && v.y === b[i]?.y && v.bulge === b[i]?.bulge);

/**
 * Removes what `ref` added to `part` (its holes by id prefix; its inner contours and lines by
 * equal geometry, so contours the user changed by hand stay).
 */
export function removeDerived(part: Part, ref: TemplateRef): void {
  const prefix = instanceHolePrefix(ref.instanceId);
  part.holes = part.holes.filter((h) => !h.id.startsWith(prefix));
  const d = deriveTemplate(ref, localBox(part));
  const x = part;
  for (const inner of d.inners) {
    const k = part.inners.findIndex((c) => sameVertices(c, inner.contour));
    if (k < 0) continue;
    part.inners.splice(k, 1);
    const ops = x.ops?.inners;
    if (x.ops && ops) {
      if (k < ops.length) ops.splice(k, 1);
      while (ops.length > 0 && ops[ops.length - 1] === null) ops.pop();
      if (ops.length === 0) delete x.ops.inners;
      if (x.ops.outline === undefined && x.ops.inners === undefined) delete x.ops;
    }
  }
  for (const line of d.lines) {
    const k = x.lines?.findIndex((l) => sameVertices(l.vertices, line.vertices)) ?? -1;
    if (k >= 0) x.lines?.splice(k, 1);
  }
  if (x.lines && x.lines.length === 0) delete x.lines;
}

/** Adds what `ref` creates to `part` (holes, inner contours with their operations, lines). */
export function addDerived(part: Part, ref: TemplateRef): void {
  const d = deriveTemplate(ref, localBox(part));
  const x = part;
  part.holes.push(...d.holes);
  for (const inner of d.inners) {
    part.inners.push(inner.contour);
    if (inner.op && inner.op.kind !== 'inside') {
      x.ops ??= {};
      x.ops.inners ??= [];
      while (x.ops.inners.length < part.inners.length - 1) x.ops.inners.push(null);
      x.ops.inners.push(inner.op);
    }
  }
  if (d.lines.length > 0) {
    x.lines ??= [];
    x.lines.push(...d.lines);
  }
}

// ---------------------------------------------------------------------------
// Params and overrides (T148, T149)
// ---------------------------------------------------------------------------

/** Param names in the order the UI lists them; `d.<hole id>` per template hole. */
export function paramKeys(geometry: TemplateGeometry): string[] {
  return ['count', 'spacing', 'edgeDistance', ...geometry.holes.map((h) => `d.${h.id}`)];
}

/** Value of param `key` (`undefined` for an unknown key). */
export function paramValue(
  params: TemplateParams,
  geometry: TemplateGeometry,
  key: string,
): number | undefined {
  if (key === 'count' || key === 'spacing' || key === 'edgeDistance') return params[key];
  if (key.startsWith('d.')) {
    const id = key.slice(2);
    const hole = geometry.holes.find((h) => h.id === id);
    return hole ? (params.d[id] ?? hole.d) : undefined;
  }
  return undefined;
}

/** The param keys whose values differ between `a` and `b`. */
export function changedParams(
  a: TemplateParams,
  b: TemplateParams,
  geometry: TemplateGeometry,
): string[] {
  return paramKeys(geometry).filter(
    (k) => paramValue(a, geometry, k) !== paramValue(b, geometry, k),
  );
}

/** A param the user changed by hand whose template default changed too (T149). */
export interface TemplateConflict {
  key: string;
  /** The user's value (kept). */
  mine: number;
  /** The new template default. */
  theirs: number;
}

/**
 * The instance after accepting `version` of its template (T149, "Evet: ölçüler güncellenir"):
 * new geometry and defaults; params the user did not override take the new defaults, overridden
 * params keep the user's value (an override whose template default also changed is a conflict).
 * Overrides of params the new version no longer has are dropped.
 */
export function upgradeInstance(
  ref: TemplateRef,
  next: { version: number; geometry: TemplateGeometry; defaults: TemplateParams },
): { ref: TemplateRef; conflicts: TemplateConflict[] } {
  const keys = new Set(paramKeys(next.geometry));
  const overrides = ref.overrides.filter((k) => keys.has(k));
  const params: TemplateParams = {
    ...next.defaults,
    d: { ...next.defaults.d },
  };
  const conflicts: TemplateConflict[] = [];
  for (const key of overrides) {
    const mine = paramValue(ref.params, ref.geometry, key);
    if (mine === undefined) continue;
    if (key === 'count' || key === 'spacing' || key === 'edgeDistance') params[key] = mine;
    else params.d[key.slice(2)] = mine;
    const was = paramValue(ref.defaults, ref.geometry, key);
    const theirs = paramValue(next.defaults, next.geometry, key);
    if (theirs !== undefined && theirs !== was && theirs !== mine) {
      conflicts.push({ key, mine, theirs });
    }
  }
  return {
    ref: {
      ...ref,
      version: next.version,
      geometry: next.geometry,
      defaults: next.defaults,
      params,
      overrides,
    },
    conflicts,
  };
}

// ---------------------------------------------------------------------------
// Board transforms (mirrorPart / rotatePart keep instances in step with their holes)
// ---------------------------------------------------------------------------

const MIRROR_EDGE_H: Record<TemplateEdge, TemplateEdge> = {
  left: 'right',
  right: 'left',
  bottom: 'bottom',
  top: 'top',
};
const MIRROR_EDGE_V: Record<TemplateEdge, TemplateEdge> = {
  left: 'left',
  right: 'right',
  bottom: 'top',
  top: 'bottom',
};
/** CCW 90°: left → bottom → right → top → left. */
const TURN_EDGE: Record<TemplateEdge, TemplateEdge> = {
  left: 'bottom',
  bottom: 'right',
  right: 'top',
  top: 'left',
};

/** The placement after the part is mirrored (`h` = left ↔ right, `v` = top ↔ bottom). */
export function mirrorPlacement(
  pl: TemplatePlacement,
  axis: 'h' | 'v',
  map: (p: Point) => Point,
): TemplatePlacement {
  const o = map({ x: pl.x, y: pl.y });
  return {
    x: o.x,
    y: o.y,
    rot: normalizeTemplateRot(axis === 'h' ? 180 - pl.rot : -pl.rot),
    mirror: !pl.mirror,
    edge: pl.edge === null ? null : (axis === 'h' ? MIRROR_EDGE_H : MIRROR_EDGE_V)[pl.edge],
  };
}

/** The placement after the part turns `turns` degrees CCW. */
export function turnPlacement(
  pl: TemplatePlacement,
  turns: 90 | 180 | 270,
  map: (p: Point) => Point,
): TemplatePlacement {
  const o = map({ x: pl.x, y: pl.y });
  let edge = pl.edge;
  for (let t = 0; t < turns / 90 && edge !== null; t++) edge = TURN_EDGE[edge];
  return { x: o.x, y: o.y, rot: normalizeTemplateRot(pl.rot + turns), mirror: pl.mirror, edge };
}

// ---------------------------------------------------------------------------
// Save as template (T147)
// ---------------------------------------------------------------------------

/** What to take from a part into a new template. */
export interface TemplateSelection {
  /** Hole ids of the part. */
  holeIds: readonly string[];
  /** Inner contour indexes of the part. */
  inners: readonly number[];
  /** Open line indexes of the part (T142); absent = none. */
  lines?: readonly number[];
  /** Reference edge; `null` = no edge (edge distance 0, free placement). */
  edge: TemplateEdge | null;
}

export type TemplateFromPartError = 'empty' | 'unknownHole' | 'unknownInner' | 'unknownLine';

/**
 * A new template from the selected holes and inner contours of `part` (T147). The reference point
 * is the first selected hole's centre (else the centre of the selected contours); the frame turns
 * with the reference edge, and the edge distance defaults to the distance from that edge, so
 * placing the result back on the same edge reproduces the selection exactly.
 */
export function templateFromPart(
  part: Part,
  sel: TemplateSelection,
): { geometry: TemplateGeometry; params: TemplateParams } | TemplateFromPartError {
  const lineIdx = sel.lines ?? [];
  if (sel.holeIds.length + sel.inners.length + lineIdx.length === 0) return 'empty';
  const holes: Hole[] = [];
  for (const id of sel.holeIds) {
    const h = part.holes.find((x) => x.id === id);
    if (!h) return 'unknownHole';
    holes.push(h);
  }
  const inners: Vertex[][] = [];
  for (const k of sel.inners) {
    const c = part.inners[k];
    if (!c) return 'unknownInner';
    inners.push(c);
  }
  const lines: NonNullable<Part['lines']> = [];
  for (const k of lineIdx) {
    const l = part.lines?.[k];
    if (!l) return 'unknownLine';
    lines.push(l);
  }
  let origin: Point;
  if (holes[0]) origin = { x: holes[0].cx, y: holes[0].cy };
  else {
    const all = [...inners.flat(), ...lines.flatMap((l) => l.vertices)];
    const xs = all.map((v) => v.x);
    const ys = all.map((v) => v.y);
    origin = {
      x: tidy((Math.min(...xs) + Math.max(...xs)) / 2),
      y: tidy((Math.min(...ys) + Math.max(...ys)) / 2),
    };
  }
  const box = localBox(part);
  const rot = sel.edge ? EDGE_ROTATION[sel.edge] : 0;
  const toLocal = (p: Point): Point => {
    const r = rotatePointBy({ x: p.x - origin.x, y: p.y - origin.y }, -rot);
    return { x: tidy(r.x), y: tidy(r.y) };
  };
  const edgeDistance = tidy(
    sel.edge === 'left'
      ? origin.x - box.minX
      : sel.edge === 'right'
        ? box.maxX - origin.x
        : sel.edge === 'bottom'
          ? origin.y - box.minY
          : sel.edge === 'top'
            ? box.maxY - origin.y
            : 0,
  );
  const geometry: TemplateGeometry = {
    holes: holes.map((h, i) => {
      const c = toLocal({ x: h.cx, y: h.cy });
      return { ...h, id: `h${i + 1}`, cx: c.x, cy: c.y };
    }),
    inners: inners.map((c, i) => {
      const moved = rotate(
        translate(contour(c.map((v) => ({ ...v }))), -origin.x, -origin.y),
        -rot,
      );
      // The cut-out keeps its operation (T142): only non-default ones are stored.
      const op = innerOperation(part, sel.inners[i] as number);
      return {
        contour: normalizeInner(
          moved.vertices.map((v) => ({ x: tidy(v.x), y: tidy(v.y), bulge: v.bulge })),
        ),
        ...(op.kind === 'inside' || op.kind === 'outside' ? {} : { op }),
      };
    }),
    ...(lines.length > 0
      ? {
          lines: lines.map((l) => {
            const op: TemplateContourOp = l.op.kind === 'online' ? l.op : { kind: 'none' };
            return { vertices: l.vertices.map((v) => ({ ...toLocal(v), bulge: v.bulge })), op };
          }),
        }
      : {}),
  };
  return {
    geometry,
    params: { count: 1, spacing: 0, edgeDistance: Math.max(0, edgeDistance), d: {} },
  };
}

/** The placement that puts a template saved with `templateFromPart` back where it came from. */
export function defaultPlacement(edge: TemplateEdge | null, at: Point): TemplatePlacement {
  return { x: at.x, y: at.y, rot: edge ? EDGE_ROTATION[edge] : 0, mirror: false, edge };
}
export * from './library';
