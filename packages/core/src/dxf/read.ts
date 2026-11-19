/**
 * DXF reader (T144, spec §4.6): `dxf-parser` (MIT) does the tokenising; this module turns its
 * entities into bulge polylines in millimetres and counts what was supported, converted,
 * ignored and skipped. Pure: text in, data out (no I/O, clock or randomness).
 *
 * Supported exactly: LINE, ARC, CIRCLE, LWPOLYLINE (bulge), POLYLINE, one level of INSERT.
 * Converted within CURVE_TOL: SPLINE, ELLIPSE (a circular ellipse stays an exact arc).
 * Ignored and counted: TEXT, MTEXT, DIMENSION, HATCH and every other entity type.
 */
import DxfParser from 'dxf-parser';
import { CURVE_TOL, EPS } from '../geometry/constants';
import { bbox as polyBBox } from '../geometry/polyline';
import { arcOf, isArc } from '../geometry/segment';
import type { BBox, Point, Polyline, Vertex } from '../geometry/types';
import {
  clampedKnots,
  fitPointCurve,
  flattenCurve,
  nurbsBreaks,
  nurbsDomain,
  nurbsPoint,
  validNurbs,
  type CurveFn,
  type Nurbs,
} from './curves';
import {
  DXF_UNIT_MM,
  type DxfDrawing,
  type DxfFileError,
  type DxfPath,
  type DxfReport,
  type DxfSkipReason,
  type DxfUnit,
  type DxfUnits,
} from './types';

// ---------------------------------------------------------------------------------------------
// File detection and parsing
// ---------------------------------------------------------------------------------------------

/** Kind of an uploaded file from its first bytes (decoded as Latin-1 / UTF-8 text). */
export function detectDxfFormat(head: string): 'dxf' | 'dwg' | 'binary-dxf' {
  if (/^AC1\d{3}/.test(head)) return 'dwg';
  if (head.startsWith('AutoCAD Binary DXF')) return 'binary-dxf';
  return 'dxf';
}

/** Raw entity as our own handlers return it: every group code/value pair, in file order. */
interface RawEntity {
  type: string;
  layer: string;
  inPaperSpace: boolean;
  groups: [number, unknown][];
}

/**
 * Entity types we read from the raw groups ourselves: CIRCLE (dxf-parser drops its extrusion),
 * ELLIPSE (extrusion) and SPLINE (dxf-parser drops the weights).
 */
const RAW_GEOMETRY = ['CIRCLE', 'ELLIPSE', 'SPLINE'] as const;

/**
 * Entity types dxf-parser has no handler for and would drop silently: registered so the report
 * can count them as ignored.
 */
const RAW_IGNORED = [
  'HATCH',
  'LEADER',
  'MLEADER',
  'MULTILEADER',
  'IMAGE',
  'WIPEOUT',
  'REGION',
  '3DSOLID',
  'BODY',
  'RAY',
  'XLINE',
  'TOLERANCE',
  'ACAD_TABLE',
  'OLE2FRAME',
  'VIEWPORT',
  'SHAPE',
  'TRACE',
  'MESH',
  'SURFACE',
  'ATTRIB',
  'ACAD_PROXY_ENTITY',
  'ARCALIGNEDTEXT',
  'RTEXT',
  'PDFUNDERLAY',
  'DWFUNDERLAY',
  'DGNUNDERLAY',
  'HELIX',
  'LIGHT',
] as const;

interface Scanner {
  next(): { code: number; value: unknown };
  isEOF(): boolean;
}

function rawHandler(name: string) {
  return class {
    ForEntityName = name;
    parseEntity(scanner: Scanner, first: { value: unknown }): RawEntity {
      const entity: RawEntity = {
        type: String(first.value),
        layer: '0',
        inPaperSpace: false,
        groups: [],
      };
      let curr = scanner.next();
      while (!scanner.isEOF() && curr.code !== 0) {
        entity.groups.push([curr.code, curr.value]);
        if (curr.code === 8) entity.layer = String(curr.value);
        if (curr.code === 67) entity.inPaperSpace = curr.value !== 0;
        curr = scanner.next();
      }
      return entity;
    }
  };
}

/** A parsed DXF: header, model-space entities and blocks, as dxf-parser returns them. */
export interface DxfParsed {
  header: Record<string, unknown>;
  entities: Entity[];
  blocks: Record<string, { name?: string; position?: Point; entities?: Entity[] }>;
}

/** Loose view of a dxf-parser entity (fields depend on the type). */
type Entity = Record<string, unknown> & { type: string; layer?: string };

export type DxfParseResult = { ok: true; value: DxfParsed } | { ok: false; error: DxfFileError };

/** Parses DXF text. DWG and binary DXF are recognised and refused with their own error. */
export function parseDxf(text: string): DxfParseResult {
  const format = detectDxfFormat(text.slice(0, 32));
  if (format === 'dwg') return { ok: false, error: 'DWG' };
  if (format === 'binary-dxf') return { ok: false, error: 'BINARY_DXF' };
  const parser = new DxfParser();
  for (const name of [...RAW_GEOMETRY, ...RAW_IGNORED]) {
    parser.registerEntityHandler(rawHandler(name) as never);
  }
  let dxf: unknown;
  try {
    dxf = parser.parseSync(text);
  } catch {
    return { ok: false, error: 'PARSE_FAILED' };
  }
  if (dxf === null || typeof dxf !== 'object') return { ok: false, error: 'PARSE_FAILED' };
  const d = dxf as Partial<DxfParsed>;
  if (!Array.isArray(d.entities)) return { ok: false, error: 'PARSE_FAILED' };
  return {
    ok: true,
    value: { header: d.header ?? {}, entities: d.entities, blocks: d.blocks ?? {} },
  };
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

/** `$INSUNITS` codes NittCam knows → unit. */
const INSUNITS: Readonly<Record<number, DxfUnit>> = {
  1: 'in',
  2: 'ft',
  4: 'mm',
  5: 'cm',
  6: 'm',
  9: 'mil',
  10: 'yd',
  13: 'um',
  14: 'dm',
};

/** A drawing whose largest extent is below this (mm) is suspicious ("parça 2 mm çıkıyorsa"). */
export const UNIT_MIN_EXTENT = 10;
/** A drawing whose largest extent is above this (mm) is suspicious (larger than any sheet × 3). */
export const UNIT_MAX_EXTENT = 10_000;

/** Units tried, in order, when suggesting a better one for an implausible size. */
const SUGGEST_ORDER: readonly DxfUnit[] = ['mm', 'in', 'cm', 'm', 'ft'];

function plausible(extentMm: number): boolean {
  return extentMm >= UNIT_MIN_EXTENT && extentMm <= UNIT_MAX_EXTENT;
}

/** First unit (other than `current`) that makes `rawExtent` drawing units a plausible size. */
function suggestUnit(rawExtent: number, current: DxfUnit): DxfUnit | undefined {
  return SUGGEST_ORDER.find((u) => u !== current && plausible(rawExtent * DXF_UNIT_MM[u]));
}

// ---------------------------------------------------------------------------------------------
// Affine transforms (x' = a·x + c·y + e, y' = b·x + d·y + f)
// ---------------------------------------------------------------------------------------------

interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `m ∘ n`: apply n first, then m. */
function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function applyT(m: Affine, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

function scaleT(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

function translateT(x: number, y: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function rotateT(rad: number): Affine {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Signed uniform scale of a similarity (+ keeps, − mirrors the direction); undefined otherwise. */
function similarity(m: Affine): number | undefined {
  const det = m.a * m.d - m.b * m.c;
  const s = Math.sqrt(Math.abs(det));
  if (s === 0) return undefined;
  const tol = 1e-9 * s;
  if (det > 0 && Math.abs(m.a - m.d) <= tol && Math.abs(m.b + m.c) <= tol) return s;
  if (det < 0 && Math.abs(m.a + m.d) <= tol && Math.abs(m.b - m.c) <= tol) return -s;
  return undefined;
}

/**
 * Object coordinate system of a 2D entity from its extrusion direction (arbitrary axis
 * algorithm): +Z = identity, −Z = mirrored X. A tilted plane returns undefined (not flat).
 */
function ocs(
  x: number | undefined,
  y: number | undefined,
  z: number | undefined,
): Affine | undefined {
  const ex = x ?? 0;
  const ey = y ?? 0;
  const ez = z ?? 1;
  if (Math.abs(ex) > 1e-9 || Math.abs(ey) > 1e-9 || ez === 0) return undefined;
  return ez > 0 ? IDENTITY : scaleT(-1, 1);
}

// ---------------------------------------------------------------------------------------------
// Polyline helpers
// ---------------------------------------------------------------------------------------------

/** An arc from angle a0 counter-clockwise to a1 (radians) as an open bulge polyline. */
function arcPolyline(cx: number, cy: number, r: number, a0: number, a1: number): Polyline {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
  const n = sweep > Math.PI ? 2 : 1;
  const bulge = Math.tan(sweep / (4 * n));
  const vertices: Vertex[] = [];
  for (let k = 0; k <= n; k++) {
    const t = a0 + (sweep * k) / n;
    vertices.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), bulge: k < n ? bulge : 0 });
  }
  return { vertices, closed: false };
}

/** A full circle as a closed polyline of two half arcs (CCW). */
function circlePolyline(cx: number, cy: number, r: number): Polyline {
  return {
    vertices: [
      { x: cx + r, y: cy, bulge: 1 },
      { x: cx - r, y: cy, bulge: 1 },
    ],
    closed: true,
  };
}

/**
 * Maps a local bulge polyline through `m`. A similarity keeps arcs exact (a mirror flips the
 * bulge sign); any other transform (non-uniform block scale) flattens arcs within CURVE_TOL.
 */
function place(poly: Polyline, m: Affine): Polyline {
  const s = similarity(m);
  if (s !== undefined) {
    const sign = s < 0 ? -1 : 1;
    return {
      closed: poly.closed,
      vertices: poly.vertices.map((v) => ({
        ...applyT(m, v),
        bulge: v.bulge === 0 ? 0 : sign * v.bulge,
      })),
    };
  }
  const vs = poly.vertices;
  const n = vs.length;
  const count = poly.closed ? n : n - 1;
  const out: Vertex[] = [];
  for (let i = 0; i < count; i++) {
    const p0 = vs[i] as Vertex;
    const p1 = vs[(i + 1) % n] as Vertex;
    const arc = arcOf(p0, p1, p0.bulge);
    if (!arc) {
      out.push({ ...applyT(m, p0), bulge: 0 });
      continue;
    }
    const fn: CurveFn = (t) =>
      applyT(m, {
        x: arc.center.x + arc.radius * Math.cos(t),
        y: arc.center.y + arc.radius * Math.sin(t),
      });
    const pts = flattenCurve(fn, arc.startAngle, arc.startAngle + arc.sweep, CURVE_TOL);
    for (let k = 0; k < pts.length - 1; k++) out.push({ ...(pts[k] as Point), bulge: 0 });
  }
  if (!poly.closed && n > 0) out.push({ ...applyT(m, vs[n - 1] as Vertex), bulge: 0 });
  return { closed: poly.closed, vertices: out };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

/**
 * Drops zero-length segments (repeated vertices) and the repeated closing vertex. Returns
 * undefined when nothing cuttable is left (fewer than 2 points, or a closed 2-point shape without
 * an arc) or a coordinate is not finite.
 */
function clean(poly: Polyline): Polyline | undefined {
  const out: Vertex[] = [];
  for (const v of poly.vertices) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.bulge))
      return undefined;
    const last = out[out.length - 1];
    if (last && samePoint(last, v)) {
      // The zero-length segment last→v disappears; v's outgoing segment starts at last.
      last.bulge = v.bulge;
      continue;
    }
    out.push({ x: v.x, y: v.y, bulge: v.bulge });
  }
  let closed = poly.closed;
  if (closed && out.length > 1 && samePoint(out[0] as Vertex, out[out.length - 1] as Vertex)) {
    out.pop();
  }
  if (out.length < 2) return undefined;
  if (!closed) (out[out.length - 1] as Vertex).bulge = 0;
  if (
    closed &&
    out.length === 2 &&
    !out.some((v, i) => isArc(v, out[(i + 1) % 2] as Vertex, v.bulge))
  ) {
    // Two points closed by straight lines: a line drawn there and back. Keep it as an open line.
    closed = false;
    (out[1] as Vertex).bulge = 0;
  }
  return { vertices: out, closed };
}

/** Polyline from flattened curve points; closed when the ends meet. */
function fromPoints(pts: readonly Point[], closed: boolean): Polyline {
  const vs = pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
  const first = vs[0];
  const last = vs[vs.length - 1];
  const ends = first !== undefined && last !== undefined && vs.length > 2 && samePoint(first, last);
  if (ends) vs.pop();
  return { vertices: vs, closed: closed || ends };
}

// ---------------------------------------------------------------------------------------------
// Raw group access
// ---------------------------------------------------------------------------------------------

function num(g: [number, unknown][], code: number, fallback: number): number {
  const hit = g.find(([c]) => c === code);
  const v = hit ? Number(hit[1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

function nums(g: [number, unknown][], code: number): number[] {
  return g.filter(([c]) => c === code).map(([, v]) => Number(v));
}

/** Points from paired x/y codes (10/20, 11/21) in file order. */
function points(g: [number, unknown][], xCode: number): (Point & { z: number })[] {
  const out: (Point & { z: number })[] = [];
  for (const [c, v] of g) {
    if (c === xCode) out.push({ x: Number(v), y: 0, z: 0 });
    else if (c === xCode + 10 && out.length) (out[out.length - 1] as Point).y = Number(v);
    else if (c === xCode + 20 && out.length)
      (out[out.length - 1] as Point & { z: number }).z = Number(v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------------------------

interface Ctx {
  report: DxfReport;
  paths: DxfPath[];
  blocks: DxfParsed['blocks'];
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

function skip(ctx: Ctx, reason: DxfSkipReason): void {
  ctx.report.skipped[reason] = (ctx.report.skipped[reason] ?? 0) + 1;
}

/** Entity types read exactly. */
const SUPPORTED = new Set(['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE']);
/** Entity types approximated. */
const CONVERTED = new Set(['SPLINE', 'ELLIPSE']);

function pt(v: unknown): Point | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const p = v as { x?: unknown; y?: unknown };
  const x = Number(p.x ?? 0);
  const y = Number(p.y ?? 0);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function emit(
  ctx: Ctx,
  layer: string,
  type: string,
  poly: Polyline | undefined,
  circle?: DxfPath['circle'],
): void {
  const cleaned = poly && clean(poly);
  if (!cleaned) {
    skip(ctx, 'DEGENERATE');
    return;
  }
  ctx.paths.push(circle ? { layer, type, poly: cleaned, circle } : { layer, type, poly: cleaned });
  if (CONVERTED.has(type)) bump(ctx.report.converted, type);
  else bump(ctx.report.supported, type);
}

/** Converts one non-INSERT entity under transform `m` (unit scale and block placement). */
function convertEntity(ctx: Ctx, e: Entity, m: Affine, layer: string): void {
  const type = e.type;
  if (type === 'LINE') {
    const vs = Array.isArray(e.vertices) ? e.vertices.map(pt) : [];
    const [a, b] = vs;
    if (!a || !b) return skip(ctx, 'DEGENERATE');
    emit(
      ctx,
      layer,
      type,
      place(
        {
          vertices: [
            { ...a, bulge: 0 },
            { ...b, bulge: 0 },
          ],
          closed: false,
        },
        m,
      ),
    );
    return;
  }
  if (type === 'ARC') {
    const o = ocs(
      e.extrusionDirectionX as number,
      e.extrusionDirectionY as number,
      e.extrusionDirectionZ as number,
    );
    if (!o) return skip(ctx, 'NOT_FLAT');
    const c = pt(e.center);
    const r = Number(e.radius);
    const a0 = Number(e.startAngle ?? 0);
    const a1 = Number(e.endAngle ?? 0);
    if (!c || !(r > 0) || !Number.isFinite(a0) || !Number.isFinite(a1))
      return skip(ctx, 'DEGENERATE');
    emit(ctx, layer, type, place(arcPolyline(c.x, c.y, r, a0, a1), compose(m, o)));
    return;
  }
  if (type === 'LWPOLYLINE') {
    const o = ocs(
      e.extrusionDirectionX as number,
      e.extrusionDirectionY as number,
      e.extrusionDirectionZ as number,
    );
    if (!o) return skip(ctx, 'NOT_FLAT');
    const raw = Array.isArray(e.vertices) ? (e.vertices as Record<string, unknown>[]) : [];
    const vertices = raw.map((v) => ({
      x: Number(v.x),
      y: Number(v.y),
      bulge: Number(v.bulge ?? 0),
    }));
    emit(ctx, layer, type, place({ vertices, closed: e.shape === true }, compose(m, o)));
    return;
  }
  if (type === 'POLYLINE') {
    if (e.isPolyfaceMesh === true || e.is3dPolygonMesh === true) return skip(ctx, 'NOT_FLAT');
    const ext = e.extrusionDirection as { x?: number; y?: number; z?: number } | undefined;
    const o = ocs(ext?.x, ext?.y, ext?.z);
    if (!o) return skip(ctx, 'NOT_FLAT');
    const raw = (Array.isArray(e.vertices) ? (e.vertices as Record<string, unknown>[]) : []).filter(
      (v) => v.splineControlPoint !== true,
    );
    if (e.is3dPolyline === true) {
      const zs = raw.map((v) => Number(v.z ?? 0));
      if (zs.some((z) => Math.abs(z - (zs[0] as number)) > EPS)) return skip(ctx, 'NOT_FLAT');
    }
    const vertices = raw.map((v) => ({
      x: Number(v.x),
      y: Number(v.y),
      bulge: Number(v.bulge ?? 0),
    }));
    emit(ctx, layer, type, place({ vertices, closed: e.shape === true }, compose(m, o)));
    return;
  }
  if (type === 'CIRCLE') {
    const g = (e as unknown as RawEntity).groups;
    const o = ocs(num(g, 210, 0), num(g, 220, 0), num(g, 230, 1));
    if (!o) return skip(ctx, 'NOT_FLAT');
    const c = { x: num(g, 10, NaN), y: num(g, 20, NaN) };
    const r = num(g, 40, NaN);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !(r > 0)) return skip(ctx, 'DEGENERATE');
    const t = compose(m, o);
    const s = similarity(t);
    const centre = applyT(t, c);
    const marker =
      s === undefined ? undefined : { cx: centre.x, cy: centre.y, d: 2 * r * Math.abs(s) };
    emit(ctx, layer, type, place(circlePolyline(c.x, c.y, r), t), marker);
    return;
  }
  if (type === 'ELLIPSE') return convertEllipse(ctx, e as unknown as RawEntity, m, layer);
  if (type === 'SPLINE') return convertSpline(ctx, e as unknown as RawEntity, m, layer);
  bump(ctx.report.ignored, type);
}

function convertEllipse(ctx: Ctx, e: RawEntity, m: Affine, layer: string): void {
  const g = e.groups;
  const nz = num(g, 230, 1);
  const c = { x: num(g, 10, NaN), y: num(g, 20, NaN) };
  const M = { x: num(g, 11, NaN), y: num(g, 21, NaN) };
  const ratio = num(g, 40, NaN);
  const t0 = num(g, 41, 0);
  let t1 = num(g, 42, 2 * Math.PI);
  const r = Math.hypot(M.x, M.y);
  if (
    ![c.x, c.y, M.x, M.y].every(Number.isFinite) ||
    !(r > 0) ||
    !(ratio > 0) ||
    ratio > 1 + 1e-9
  ) {
    return skip(ctx, 'DEGENERATE');
  }
  if (Math.abs(num(g, 210, 0)) > 1e-9 || Math.abs(num(g, 220, 0)) > 1e-9)
    return skip(ctx, 'NOT_FLAT');
  // Minor axis = extrusion × major axis, scaled by the ratio (WCS coordinates).
  const minor = nz >= 0 ? { x: -M.y * ratio, y: M.x * ratio } : { x: M.y * ratio, y: -M.x * ratio };
  while (t1 <= t0) t1 += 2 * Math.PI;
  const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9 || Math.abs(t1 - t0) < 1e-12;
  if (full) t1 = t0 + 2 * Math.PI;
  const circular = Math.abs(ratio - 1) < 1e-9;
  const s = similarity(m);
  if (circular && s !== undefined) {
    // A circle or circular arc: keep it exact.
    const theta = Math.atan2(M.y, M.x);
    if (full) {
      const centre = applyT(m, c);
      emit(ctx, layer, 'ELLIPSE', place(circlePolyline(c.x, c.y, r), m), {
        cx: centre.x,
        cy: centre.y,
        d: 2 * r * Math.abs(s),
      });
      return;
    }
    const arc =
      nz >= 0
        ? arcPolyline(c.x, c.y, r, theta + t0, theta + t1)
        : reverseOpen(arcPolyline(c.x, c.y, r, theta - t1, theta - t0));
    emit(ctx, layer, 'ELLIPSE', place(arc, m));
    return;
  }
  const fn: CurveFn = (t) =>
    applyT(m, {
      x: c.x + M.x * Math.cos(t) + minor.x * Math.sin(t),
      y: c.y + M.y * Math.cos(t) + minor.y * Math.sin(t),
    });
  const breaks: number[] = [];
  for (let q = Math.ceil(t0 / (Math.PI / 2)); q * (Math.PI / 2) < t1; q++)
    breaks.push(q * (Math.PI / 2));
  emit(ctx, layer, 'ELLIPSE', fromPoints(flattenCurve(fn, t0, t1, CURVE_TOL, breaks), full));
}

/** An open polyline traversed backwards (arc bulges change sign). */
function reverseOpen(poly: Polyline): Polyline {
  const vs = poly.vertices;
  const n = vs.length;
  const out: Vertex[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const prev = vs[i - 1];
    out.push({
      x: (vs[i] as Vertex).x,
      y: (vs[i] as Vertex).y,
      bulge: prev && prev.bulge !== 0 ? -prev.bulge : 0,
    });
  }
  return { vertices: out, closed: false };
}

function convertSpline(ctx: Ctx, e: RawEntity, m: Affine, layer: string): void {
  const g = e.groups;
  const flags = num(g, 70, 0);
  const closedFlag = (flags & 1) !== 0 || (flags & 2) !== 0;
  const degree = num(g, 71, 3);
  const controls = points(g, 10);
  const fits = points(g, 11);
  const all = controls.length ? controls : fits;
  if (all.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return skip(ctx, 'BAD_CURVE');
  if (all.some((p) => Math.abs(p.z - (all[0] as { z: number }).z) > EPS))
    return skip(ctx, 'NOT_FLAT');
  if (controls.length >= Math.max(2, degree + 1)) {
    const weights = nums(g, 41);
    let curve: Nurbs = {
      degree,
      controls,
      knots: nums(g, 40),
      ...(weights.length === controls.length ? { weights } : {}),
    };
    if (!validNurbs(curve)) {
      const { weights: w, ...rest } = curve;
      curve = {
        ...rest,
        knots: clampedKnots(controls.length, degree),
        ...(w && w.every((x) => x > 0) ? { weights: w } : {}),
      };
      if (!validNurbs(curve)) return skip(ctx, 'BAD_CURVE');
    }
    const [t0, t1] = nurbsDomain(curve);
    const c = curve;
    const pts = flattenCurve((t) => applyT(m, nurbsPoint(c, t)), t0, t1, CURVE_TOL, nurbsBreaks(c));
    emit(ctx, layer, 'SPLINE', fromPoints(pts, closedFlag));
    return;
  }
  if (fits.length >= 2) {
    const { fn, t1 } = fitPointCurve(fits, closedFlag);
    const breaks = Array.from({ length: Math.max(0, Math.ceil(t1) - 1) }, (_, i) => i + 1);
    const pts = flattenCurve((t) => applyT(m, fn(t)), 0, t1, CURVE_TOL, breaks);
    ctx.report.fitPointSplines += 1;
    emit(ctx, layer, 'SPLINE', fromPoints(pts, closedFlag));
    return;
  }
  skip(ctx, 'BAD_CURVE');
}

/** Expands one INSERT (one level; INSERTs inside the block are skipped and counted). */
function convertInsert(ctx: Ctx, ins: Entity, unit: Affine): void {
  const block = ctx.blocks[String(ins.name ?? '')];
  if (!block) return skip(ctx, 'MISSING_BLOCK');
  const ext = ins.extrusionDirection as { x?: number; y?: number; z?: number } | undefined;
  const o = ocs(ext?.x, ext?.y, ext?.z);
  if (!o) return skip(ctx, 'NOT_FLAT');
  ctx.report.inserts += 1;
  const pos = pt(ins.position) ?? { x: 0, y: 0 };
  const base = pt(block.position) ?? { x: 0, y: 0 };
  const sx = Number(ins.xScale ?? 1) || 1;
  const sy = Number(ins.yScale ?? 1) || 1;
  const rot = (Number(ins.rotation ?? 0) * Math.PI) / 180;
  const cols = Math.max(1, Math.floor(Number(ins.columnCount ?? 1)) || 1);
  const rows = Math.max(1, Math.floor(Number(ins.rowCount ?? 1)) || 1);
  const cs = Number(ins.columnSpacing ?? 0) || 0;
  const rs = Number(ins.rowSpacing ?? 0) || 0;
  const insLayer = ins.layer ?? '0';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const off = applyT(rotateT(rot), { x: col * cs, y: row * rs });
      const local = compose(
        translateT(pos.x + off.x, pos.y + off.y),
        compose(rotateT(rot), compose(scaleT(sx, sy), translateT(-base.x, -base.y))),
      );
      const m = compose(unit, compose(o, local));
      for (const e of block.entities ?? []) {
        if (e.inPaperSpace === true) continue;
        if (e.type === 'INSERT') {
          skip(ctx, 'NESTED_INSERT');
          continue;
        }
        const layer = !e.layer || e.layer === '0' ? insLayer : e.layer;
        convertEntity(ctx, e, m, layer);
      }
    }
  }
}

export interface ConvertDxfOptions {
  /** The unit the user chose; overrides `$INSUNITS` and clears `UNIT_UNCERTAIN`. */
  unit?: DxfUnit;
}

function emptyReport(): DxfReport {
  return { supported: {}, converted: {}, fitPointSplines: 0, ignored: {}, skipped: {}, inserts: 0 };
}

function unionBBox(paths: readonly DxfPath[]): BBox | undefined {
  let box: BBox | undefined;
  for (const p of paths) {
    const b = polyBBox(p.poly);
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : b;
  }
  return box;
}

/**
 * Converts a parsed DXF into bulge polylines in millimetres plus the import report. The unit
 * comes from `options.unit`, else `$INSUNITS`; a missing/unknown unit or an implausible size sets
 * `units.uncertain` (`UNIT_UNCERTAIN`) and the caller asks the user (spec §4.6).
 */
export function convertDxf(parsed: DxfParsed, options: ConvertDxfOptions = {}): DxfDrawing {
  const ins = parsed.header.$INSUNITS;
  const insunits = typeof ins === 'number' && Number.isFinite(ins) ? ins : undefined;
  const fromHeader = insunits === undefined ? undefined : INSUNITS[insunits];
  const unit: DxfUnit = options.unit ?? fromHeader ?? 'mm';
  const scale = DXF_UNIT_MM[unit];
  const unitT = scaleT(scale, scale);
  const ctx: Ctx = { report: emptyReport(), paths: [], blocks: parsed.blocks };
  for (const e of parsed.entities) {
    if (e.inPaperSpace === true) {
      skip(ctx, 'PAPER_SPACE');
      continue;
    }
    if (e.type === 'INSERT') convertInsert(ctx, e, unitT);
    else convertEntity(ctx, e, unitT, e.layer ?? '0');
  }
  const box = unionBBox(ctx.paths);
  const units: DxfUnits = { insunits, unit, scale };
  if (!options.unit) {
    const extent = box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : undefined;
    const suggested =
      extent === undefined || plausible(extent) ? undefined : suggestUnit(extent / scale, unit);
    const reason =
      insunits === undefined
        ? 'missing'
        : insunits === 0
          ? 'unitless'
          : !fromHeader
            ? 'unknown'
            : undefined;
    if (reason || (extent !== undefined && !plausible(extent))) {
      units.uncertain = {
        code: 'UNIT_UNCERTAIN',
        reason: reason ?? 'size',
        ...(suggested ? { suggested } : {}),
      };
    }
  }
  const layers = [...new Set(ctx.paths.map((p) => p.layer))].sort();
  return { units, paths: ctx.paths, report: ctx.report, layers, bbox: box };
}

/** True for a DXF type NittCam reads (exactly or approximated). */
export function isDxfGeometryType(type: string): boolean {
  return SUPPORTED.has(type) || CONVERTED.has(type) || type === 'INSERT';
}

export type DxfReadResult = { ok: true; value: DxfDrawing } | { ok: false; error: DxfFileError };

/** Parse + convert in one step; `EMPTY` when the file has no cuttable geometry at all. */
export function readDxf(text: string, options: ConvertDxfOptions = {}): DxfReadResult {
  const parsed = parseDxf(text);
  if (!parsed.ok) return parsed;
  const drawing = convertDxf(parsed.value, options);
  return drawing.paths.length === 0 ? { ok: false, error: 'EMPTY' } : { ok: true, value: drawing };
}
