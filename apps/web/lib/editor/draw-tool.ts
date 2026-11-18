/**
 * Drawing tools of the board (T127–T129, spec §4.4, D-039): a pure state machine for the
 * rectangle, circle, line/polyline and arc tools. The in-progress shape (`DrawDraft`) is UI state;
 * a finished shape comes out as `DrawnShape`, which the board sends as one `drawPart` command.
 * Geometry comes from `@nittcam/core`; this module only sequences clicks and typed values.
 */
import {
  EPS,
  arcOf,
  bulgeFromRadius,
  bulgeThrough,
  circleOutline,
  closePath,
  closesAt,
  nextVertex,
  rectFromCorners,
  rectFromSize,
  segmentMidpoint,
  tidy,
  type Vertex,
} from '@nittcam/core';
import type { Pt } from './viewport';

export type DrawTool = 'rect' | 'circle' | 'line' | 'arc';

export const DRAW_TOOLS: readonly DrawTool[] = ['rect', 'circle', 'line', 'arc'];

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
      /** Arc tool: the chosen end point, waiting for the point on the arc (or a typed R). */
      pending: Pt | null;
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
export function fieldsFor(tool: DrawTool, draft: DrawDraft | null): DrawField[] {
  if (!draft) return [];
  if (draft.kind === 'rect') return ['w', 'h'];
  if (draft.kind === 'circle') return ['r'];
  if (draft.open) return [];
  if (tool === 'arc' && draft.pending) return ['r'];
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

/** True when `p` lies right of the chord a → b (the side of a positive bulge). */
function rightOf(a: Pt, b: Pt, p: Pt): boolean {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0;
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
  if (tool === 'arc' && draft.pending) {
    const from = last(pts);
    const end = draft.pending;
    const r = pos(typed.r);
    const bulge =
      r !== undefined
        ? bulgeFromRadius(from, end, r, rightOf(from, end, at))
        : bulgeThrough(from, at, end);
    if (bulge === undefined || bulge === 0) return { draft };
    const bent = pts.map((v, i) => (i === pts.length - 1 ? { ...v, bulge } : v));
    return addVertex(bent, end);
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
): DrawStep {
  const any = Object.values(typed).some((v) => v !== undefined);
  if (any) return clickAt(tool, draft, cursor, typed, lock);
  if (draft?.kind === 'path' && draft.pts.length >= 2) {
    return { draft: { ...draft, pending: null, open: true } };
  }
  return { draft };
}

/** Backspace: drops the arc end point, else the last vertex (the path ends when empty). */
export function backspace(draft: DrawDraft | null): DrawDraft | null {
  if (draft?.kind !== 'path') return draft;
  if (draft.pending) return { ...draft, pending: null };
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
}

/** Preview of the draft with the cursor at `p` (snapped). */
export function preview(
  tool: DrawTool,
  draft: DrawDraft | null,
  p: Pt,
  typed: Typed = {},
  lock = false,
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
  if (tool === 'arc' && draft.pending) {
    const end = draft.pending;
    const r = pos(typed.r);
    const bulge =
      (r !== undefined
        ? bulgeFromRadius(from, end, r, rightOf(from, end, p))
        : bulgeThrough(from, p, end)) ?? 0;
    const arc = arcOf(from, end, bulge);
    return {
      ...base,
      vertices: pts,
      closed: false,
      nodes: [...nodes, end],
      rubber: { from, to: end, bulge },
      closing: closesAt(pts[0] as Vertex, end) && pts.length >= 2,
      centre: arc?.center ?? null,
      live: { r: arc ? tidy(arc.radius) : 0 },
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
  | 'open';

export function hintFor(tool: DrawTool, draft: DrawDraft | null, view: DraftView | null): DrawHint {
  if (tool === 'rect') return draft ? 'rectEnd' : 'rectStart';
  if (tool === 'circle') return draft ? 'circleEnd' : 'circleStart';
  if (draft?.kind === 'path' && draft.open) return 'open';
  if (view?.closing) return 'lineClose';
  if (tool === 'arc') {
    if (draft?.kind !== 'path') return 'arcStart';
    return draft.pending ? 'arcBend' : 'arcEnd';
  }
  return draft?.kind === 'path' ? 'lineNext' : 'lineStart';
}
