/**
 * Drawing tools of the board (T127–T129, spec §4.4, D-039): a pure state machine for the
 * rectangle, circle, line/polyline and arc tools. The in-progress shape (`DrawDraft`) is UI state;
 * a finished shape comes out as `DrawnShape`, which the board sends as one `drawPart` command.
 * Geometry comes from `@nittcam/core`; this module only sequences clicks and typed values.
 */
import {
  EPS,
  arcAround,
  arcOf,
  bulgeFree,
  bulgeThrough,
  circleOutline,
  closePath,
  closesAt,
  nextVertex,
  rectFromCorners,
  rectFromSize,
  segmentMidpoint,
  tangentArc,
  tidy,
  unwrapSweep,
  type Vertex,
} from '@nittcam/core';
import type { Pt } from './viewport';

export type DrawTool = 'rect' | 'circle' | 'line' | 'arc';

export const DRAW_TOOLS: readonly DrawTool[] = ['rect', 'circle', 'line', 'arc'];

/**
 * Arc construction (T382): 'bulge' = start, end, then drag the bulge (sehim) freely; '3pt' = start,
 * a point on the arc, end; 'centre' = start, centre, then the sweep around it.
 */
export type ArcMode = 'bulge' | '3pt' | 'centre';

export const ARC_MODES: readonly ArcMode[] = ['bulge', '3pt', 'centre'];

/** Arc tool options (T382): the mode and "tangent at a line end" (bulge mode). */
export interface DrawOptions {
  arcMode: ArcMode;
  tangent: boolean;
}

export const DEFAULT_DRAW_OPTIONS: DrawOptions = { arcMode: 'bulge', tangent: true };

export function isDrawTool(tool: string): tool is DrawTool {
  return (DRAW_TOOLS as readonly string[]).includes(tool);
}

/** In-progress shape. Path vertices carry the bulge of the segment that starts at them. */
export type DrawDraft =
  | { kind: 'rect'; a: Pt }
  | { kind: 'circle'; c: Pt }
  | {
      kind: 'path';
      pts: Vertex[];
      /**
       * Arc tool, second point (T382): the end ('bulge' mode), the point on the arc ('3pt') or the
       * centre ('centre'); null while the next click is that point.
       */
      pending: Pt | null;
      /** Centre mode: the sweep so far (radians), unwrapped from the mouse path. */
      sweep?: number;
      /** Finished with Enter while not closed: shown as "kapalı değil" until resumed or Esc. */
      open: boolean;
    };

/** Fields of the dynamic input chip, by state. */
export type DrawField = 'w' | 'h' | 'r' | 'length' | 'angle';

/** A finished shape: board corner + `drawPart` shape. */
export interface DrawnShape {
  at: Pt;
  shape:
    | { kind: 'rect'; params: { w: number; h: number; r: number } }
    | { kind: 'outline'; vertices: Vertex[] };
}

export interface DrawStep {
  draft: DrawDraft | null;
  commit?: DrawnShape;
}

/** Typed values by field (undefined = not typed, the cursor decides). */
export type Typed = Partial<Record<DrawField, number>>;

/** Parses a typed number; a comma is a decimal separator (Turkish keyboards). */
export function parseTyped(s: string): number | undefined {
  const t = s.trim().replace(',', '.');
  if (t === '' || t === '-' || t === '.') return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/** Chip fields for the current tool and draft (empty: nothing to type yet). */
export function fieldsFor(
  tool: DrawTool,
  draft: DrawDraft | null,
  opts: DrawOptions = DEFAULT_DRAW_OPTIONS,
): DrawField[] {
  if (!draft) return [];
  if (draft.kind === 'rect') return ['w', 'h'];
  if (draft.kind === 'circle') return ['r'];
  if (draft.open) return [];
  if (tool === 'arc' && draft.pending) {
    // In arc states 'angle' is the sweep (T382).
    if (opts.arcMode === 'bulge') return ['r', 'angle'];
    if (opts.arcMode === 'centre') return ['angle'];
    return [];
  }
  if (tool === 'arc' && tangentFrom(draft.pts, opts)) return ['r', 'angle'];
  return ['length', 'angle'];
}

function last(pts: readonly Vertex[]): Vertex {
  return pts[pts.length - 1] as Vertex;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pos(v: number | undefined): number | undefined {
  return v !== undefined && v > EPS ? v : undefined;
}

/**
 * Direction a tangent arc continues (T382): the last segment of the path when it is a straight
 * line and the arc tool is in 'bulge' mode with "tangent" on; undefined otherwise.
 */
export function tangentFrom(pts: readonly Vertex[], opts: DrawOptions): Pt | undefined {
  if (opts.arcMode !== 'bulge' || !opts.tangent || pts.length < 2) return undefined;
  const a = pts[pts.length - 2] as Vertex;
  const b = last(pts);
  if (a.bulge !== 0) return undefined;
  const d = { x: b.x - a.x, y: b.y - a.y };
  return Math.hypot(d.x, d.y) > EPS ? d : undefined;
}

/** The arc the path would get with the cursor at `p` (T382), or undefined (no arc yet). */
function arcAt(
  draft: Extract<DrawDraft, { kind: 'path' }>,
  p: Pt,
  typed: Typed,
  opts: DrawOptions,
): { end: Pt; bulge: number } | undefined {
  const from = last(draft.pts);
  const r = pos(typed.r);
  const sweep = typed.angle !== undefined && Math.abs(typed.angle) > EPS ? typed.angle : undefined;
  const fixed = { ...(r !== undefined ? { r } : {}), ...(sweep !== undefined ? { sweep } : {}) };
  if (!draft.pending) {
    const dir = tangentFrom(draft.pts, opts);
    const t = dir ? tangentArc(from, dir, p, fixed) : undefined;
    return t ? { end: t.end, bulge: t.bulge } : undefined;
  }
  if (opts.arcMode === 'bulge') {
    const bulge = bulgeFree(from, draft.pending, p, fixed);
    return bulge === undefined ? undefined : { end: draft.pending, bulge };
  }
  if (opts.arcMode === '3pt') {
    const end = { x: tidy(p.x), y: tidy(p.y) };
    const bulge = bulgeThrough(from, draft.pending, end);
    return bulge === 0 ? undefined : { end, bulge };
  }
  const turn = unwrapSweep(draft.pending, from, p, draft.sweep ?? 0);
  const s = sweep !== undefined ? (Math.abs(sweep) * Math.PI * (turn < 0 ? -1 : 1)) / 180 : turn;
  return arcAround(draft.pending, from, s);
}

/**
 * Centre mode (T382): follows the mouse so the sweep unwraps past 180° and either turn direction
 * works. Call on every cursor move; returns the same draft when nothing changes.
 */
export function trackSweep(
  tool: DrawTool,
  draft: DrawDraft | null,
  p: Pt,
  opts: DrawOptions,
): DrawDraft | null {
  if (tool !== 'arc' || opts.arcMode !== 'centre' || draft?.kind !== 'path' || !draft.pending)
    return draft;
  const sweep = unwrapSweep(draft.pending, last(draft.pts), p, draft.sweep ?? 0);
  return sweep === draft.sweep ? draft : { ...draft, sweep };
}

/** Next path point from the last vertex: typed length/angle, Shift lock, else the cursor. */
function pathPoint(pts: readonly Vertex[], cursor: Pt, typed: Typed, lock: boolean): Pt {
  const from = last(pts);
  return nextVertex(from, cursor, {
    ...(pos(typed.length) !== undefined ? { length: typed.length } : {}),
    ...(typed.angle !== undefined ? { angle: ((typed.angle % 360) + 360) % 360 } : {}),
    lock,
  });
}

/** Adds a vertex; closes the path into a part when it lands on the start (JOIN_TOL). */
function addVertex(pts: readonly Vertex[], p: Pt): DrawStep {
  const start = pts[0] as Vertex;
  const at = { x: tidy(p.x), y: tidy(p.y) };
  if (closesAt(start, at) && pts.length >= 2) {
    const closed = closePath([...pts, { x: start.x, y: start.y, bulge: 0 }]);
    if (closed)
      return {
        draft: null,
        commit: { at: { x: 0, y: 0 }, shape: { kind: 'outline', vertices: closed } },
      };
    // Too few vertices to close (two straight segments): keep drawing.
    return { draft: { kind: 'path', pts: [...pts], pending: null, open: false } };
  }
  return {
    draft: { kind: 'path', pts: [...pts, { ...at, bulge: 0 }], pending: null, open: false },
  };
}

/**
 * A click (or Enter with typed values) at the snapped point `p`. Returns the next draft and, when
 * the shape is finished, the shape to commit.
 */
export function clickAt(
  tool: DrawTool,
  draft: DrawDraft | null,
  p: Pt,
  typed: Typed = {},
  lock = false,
  opts: DrawOptions = DEFAULT_DRAW_OPTIONS,
): DrawStep {
  const at = { x: tidy(p.x), y: tidy(p.y) };
  if (tool === 'rect') {
    if (draft?.kind !== 'rect') return { draft: { kind: 'rect', a: at } };
    const w = pos(typed.w);
    const h = pos(typed.h);
    const r =
      w !== undefined || h !== undefined
        ? rectFromSize(
            draft.a,
            at,
            w ?? Math.abs(at.x - draft.a.x),
            h ?? Math.abs(at.y - draft.a.y),
          )
        : rectFromCorners(draft.a, at);
    if (r.w < EPS || r.h < EPS) return { draft };
    return {
      draft: null,
      commit: {
        at: { x: tidy(r.x), y: tidy(r.y) },
        shape: { kind: 'rect', params: { w: tidy(r.w), h: tidy(r.h), r: 0 } },
      },
    };
  }
  if (tool === 'circle') {
    if (draft?.kind !== 'circle') return { draft: { kind: 'circle', c: at } };
    const r = pos(typed.r) ?? dist(draft.c, at);
    if (r < EPS) return { draft };
    return {
      draft: null,
      commit: {
        at: { x: tidy(draft.c.x - r), y: tidy(draft.c.y - r) },
        shape: { kind: 'outline', vertices: circleOutline(r) },
      },
    };
  }
  // Line and arc share one path, so switching L ↔ A mid-shape keeps what is drawn.
  if (draft?.kind !== 'path') {
    return { draft: { kind: 'path', pts: [{ ...at, bulge: 0 }], pending: null, open: false } };
  }
  const pts = draft.pts;
  if (tool === 'arc' && (draft.pending || tangentFrom(pts, opts))) {
    const arc = arcAt(draft, at, typed, opts);
    if (!arc || dist(arc.end, last(pts)) < EPS) return { draft };
    const bent = pts.map((v, i) => (i === pts.length - 1 ? { ...v, bulge: arc.bulge } : v));
    return addVertex(bent, arc.end);
  }
  const next = pathPoint(pts, at, typed, lock);
  if (dist(next, last(pts)) < EPS) return { draft: { ...draft, open: false } };
  if (tool === 'arc') {
    return { draft: { kind: 'path', pts: [...pts], pending: next, open: false } };
  }
  return addVertex(pts, next);
}

/** Enter: commits typed values like a click; without values an open path is finished as open. */
export function enter(
  tool: DrawTool,
  draft: DrawDraft | null,
  cursor: Pt,
  typed: Typed,
  lock = false,
  opts: DrawOptions = DEFAULT_DRAW_OPTIONS,
): DrawStep {
  const any = Object.values(typed).some((v) => v !== undefined);
  if (any) return clickAt(tool, draft, cursor, typed, lock, opts);
  if (draft?.kind === 'path' && draft.pts.length >= 2) {
    return { draft: { ...draft, pending: null, open: true } };
  }
  return { draft };
}

/** Backspace: drops the arc end point, else the last vertex (the path ends when empty). */
export function backspace(draft: DrawDraft | null): DrawDraft | null {
  if (draft?.kind !== 'path') return draft;
  if (draft.pending) return { kind: 'path', pts: draft.pts, pending: null, open: draft.open };
  const pts = draft.pts.slice(0, -1);
  if (pts.length === 0) return null;
  const end = pts.length - 1;
  return { ...draft, open: false, pts: pts.map((v, i) => (i === end ? { ...v, bulge: 0 } : v)) };
}

/** What the canvas draws for the draft (board mm). */
export interface DraftView {
  /** Placed geometry: a closed contour (rect, circle) or the open path so far. */
  vertices: Vertex[];
  closed: boolean;
  /** Dashed rubber-band segment to the cursor (bulge for an arc preview). */
  rubber: { from: Pt; to: Pt; bulge: number } | null;
  /** Placed path vertices (square nodes). */
  nodes: Pt[];
  /** The cursor closes the path: the start node grows and shows "Kapat". */
  closing: boolean;
  /** Finished open path: warning stroke + "Kapalı değil" chip. */
  open: boolean;
  /** Arc centre while bending (small cross). */
  centre: Pt | null;
  /** Live values per chip field (same order as `fieldsFor`). */
  live: Partial<Record<DrawField, number>>;
  /** Arc being placed (T382): radius, sweep (degrees, unsigned) and chord for the canvas label. */
  arc?: { r: number; sweep: number; chord: number };
}

/** Preview of the draft with the cursor at `p` (snapped). */
export function preview(
  tool: DrawTool,
  draft: DrawDraft | null,
  p: Pt,
  typed: Typed = {},
  lock = false,
  opts: DrawOptions = DEFAULT_DRAW_OPTIONS,
): DraftView | null {
  if (!draft) return null;
  const base = { rubber: null, nodes: [], closing: false, open: false, centre: null };
  if (draft.kind === 'rect') {
    const w = pos(typed.w);
    const h = pos(typed.h);
    const r =
      w !== undefined || h !== undefined
        ? rectFromSize(draft.a, p, w ?? Math.abs(p.x - draft.a.x), h ?? Math.abs(p.y - draft.a.y))
        : rectFromCorners(draft.a, p);
    return {
      ...base,
      vertices: [
        { x: r.x, y: r.y, bulge: 0 },
        { x: r.x + r.w, y: r.y, bulge: 0 },
        { x: r.x + r.w, y: r.y + r.h, bulge: 0 },
        { x: r.x, y: r.y + r.h, bulge: 0 },
      ],
      closed: true,
      live: { w: tidy(r.w), h: tidy(r.h) },
    };
  }
  if (draft.kind === 'circle') {
    const r = pos(typed.r) ?? dist(draft.c, p);
    return {
      ...base,
      vertices: circleOutline(r).map((v) => ({
        ...v,
        x: v.x + draft.c.x - r,
        y: v.y + draft.c.y - r,
      })),
      closed: r > EPS,
      centre: draft.c,
      live: { r: tidy(r) },
    };
  }
  const pts = draft.pts;
  const from = last(pts);
  const nodes = pts.map((v) => ({ x: v.x, y: v.y }));
  if (draft.open) {
    return { ...base, vertices: pts, closed: false, nodes, open: true, live: {} };
  }
  if (tool === 'arc' && (draft.pending || tangentFrom(pts, opts))) {
    const placed = arcAt(draft, p, typed, opts);
    const pending = draft.pending;
    // Without an arc yet (cursor on the chord): a straight rubber band to where the end would be.
    const end = placed?.end ?? (opts.arcMode === 'bulge' && pending ? pending : p);
    const bulge = placed?.bulge ?? 0;
    const arc = arcOf(from, end, bulge);
    const sweep = arc ? tidy(Math.abs((arc.sweep * 180) / Math.PI)) : 0;
    const shown = pending ? [...nodes, pending] : nodes;
    return {
      ...base,
      vertices: pts,
      closed: false,
      nodes: opts.arcMode === 'bulge' || !pending ? shown : [...shown, end],
      rubber: { from, to: end, bulge },
      closing: closesAt(pts[0] as Vertex, end) && pts.length >= 2,
      centre: arc?.center ?? (opts.arcMode === 'centre' ? pending : null),
      live: { r: arc ? tidy(arc.radius) : 0, angle: sweep },
      ...(arc ? { arc: { r: tidy(arc.radius), sweep, chord: tidy(dist(from, end)) } } : {}),
    };
  }
  const next = pathPoint(pts, p, typed, lock);
  const length = dist(from, next);
  const angle =
    length > EPS ? ((Math.atan2(next.y - from.y, next.x - from.x) * 180) / Math.PI + 360) % 360 : 0;
  return {
    ...base,
    vertices: pts,
    closed: false,
    nodes,
    rubber: { from, to: next, bulge: 0 },
    closing: pts.length >= 2 && closesAt(pts[0] as Vertex, next),
    live: { length: tidy(length), angle: tidy(angle) },
  };
}

/** Point the hint chip of an open shape sits at: middle of its first segment. */
export function openChipAt(pts: readonly Vertex[]): Pt | null {
  const a = pts[0];
  const b = pts[1];
  if (!a || !b) return null;
  return segmentMidpoint(a, b, a.bulge);
}

/** Status-bar hint key for the current tool and draft. */
export type DrawHint =
  | 'rectStart'
  | 'rectEnd'
  | 'circleStart'
  | 'circleEnd'
  | 'lineStart'
  | 'lineNext'
  | 'lineClose'
  | 'arcStart'
  | 'arcEnd'
  | 'arcBend'
  | 'arcTangent'
  | 'arcVia'
  | 'arcVia2'
  | 'arcCentre'
  | 'arcSweep'
  | 'open';

export function hintFor(
  tool: DrawTool,
  draft: DrawDraft | null,
  view: DraftView | null,
  opts: DrawOptions = DEFAULT_DRAW_OPTIONS,
): DrawHint {
  if (tool === 'rect') return draft ? 'rectEnd' : 'rectStart';
  if (tool === 'circle') return draft ? 'circleEnd' : 'circleStart';
  if (draft?.kind === 'path' && draft.open) return 'open';
  if (view?.closing) return 'lineClose';
  if (tool === 'arc') {
    if (draft?.kind !== 'path') return 'arcStart';
    const mode = opts.arcMode;
    if (draft.pending)
      return mode === 'bulge' ? 'arcBend' : mode === '3pt' ? 'arcVia2' : 'arcSweep';
    if (tangentFrom(draft.pts, opts)) return 'arcTangent';
    return mode === 'bulge' ? 'arcEnd' : mode === '3pt' ? 'arcVia' : 'arcCentre';
  }
  return draft?.kind === 'path' ? 'lineNext' : 'lineStart';
}

/** localStorage key of the arc tool options (T382: "last used mode remembered"). */
export const DRAW_OPTIONS_KEY = 'nittcam.drawOptions';

/** Stored arc options; anything unreadable falls back to the defaults. */
export function parseDrawOptions(raw: string | null): DrawOptions {
  if (!raw) return DEFAULT_DRAW_OPTIONS;
  try {
    const v = JSON.parse(raw) as Partial<DrawOptions>;
    return {
      arcMode: ARC_MODES.includes(v.arcMode as ArcMode)
        ? (v.arcMode as ArcMode)
        : DEFAULT_DRAW_OPTIONS.arcMode,
      tangent: typeof v.tangent === 'boolean' ? v.tangent : DEFAULT_DRAW_OPTIONS.tangent,
    };
  } catch {
    return DEFAULT_DRAW_OPTIONS;
  }
}

export function loadDrawOptions(): DrawOptions {
  try {
    return parseDrawOptions(window.localStorage.getItem(DRAW_OPTIONS_KEY));
  } catch {
    return DEFAULT_DRAW_OPTIONS;
  }
}

export function saveDrawOptions(opts: DrawOptions): void {
  try {
    window.localStorage.setItem(DRAW_OPTIONS_KEY, JSON.stringify(opts));
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}
