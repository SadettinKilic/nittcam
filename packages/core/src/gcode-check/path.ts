/**
 * The read path in the sheet frame (T019, D-027): every move of the reader converted with the
 * checks' own inverse frame, plus small arc helpers. Pure.
 */
import type { GcodeAxis, GcodeEvent, GcodeMove } from '../gcode-reader';
import { sheetDirection, sheetPoint, sheetXY, type CheckFrame } from './frame';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface SheetArc {
  cx: number;
  cy: number;
  r: number;
  /** Swept angle, (0, 2π]. */
  sweep: number;
  dir: 'cw' | 'ccw';
}

/** One read move in the sheet frame. `raw` keeps the reader's move (machine frame). */
export interface SheetMove {
  index: number;
  line: number;
  kind: 'rapid' | 'feed' | 'arc';
  from: P3;
  to: P3;
  arc?: SheetArc;
  /** Axes never set absolutely at the start / end of the move. */
  fromAssumed: readonly GcodeAxis[];
  toAssumed: readonly GcodeAxis[];
  raw: GcodeMove;
}

export function toSheetMoves(
  moves: readonly GcodeMove[],
  f: CheckFrame,
  events: readonly GcodeEvent[] = [],
): SheetMove[] {
  const out: SheetMove[] = [];
  let prevAssumed: readonly GcodeAxis[] = ['x', 'y', 'z'];
  // A G53 machine move (T309) makes its axes unknown in the work frame before the next move.
  const unknownBefore = new Map<number, Set<GcodeAxis>>();
  for (const e of events) {
    if (e.kind !== 'machineMove') continue;
    const set = unknownBefore.get(e.moveIndex) ?? new Set<GcodeAxis>();
    if (e.x !== null) set.add('x');
    if (e.y !== null) set.add('y');
    unknownBefore.set(e.moveIndex, set);
  }
  moves.forEach((m, index) => {
    const extra = unknownBefore.get(index);
    if (extra) {
      prevAssumed = (['x', 'y', 'z'] as const).filter(
        (a) => prevAssumed.includes(a) || extra.has(a),
      );
    }
    const s: SheetMove = {
      index,
      line: m.line,
      kind: m.type === 'rapid' ? 'rapid' : m.arc ? 'arc' : 'feed',
      from: sheetPoint(f, m.from),
      to: sheetPoint(f, m.to),
      fromAssumed: prevAssumed,
      toAssumed: m.assumedAxes,
      raw: m,
    };
    if (m.arc) {
      const c = sheetXY(f, m.arc.cx, m.arc.cy);
      s.arc = {
        cx: c.x,
        cy: c.y,
        r: m.arc.radius,
        sweep: m.arc.sweep,
        dir: sheetDirection(f, m.arc.direction),
      };
    }
    prevAssumed = m.assumedAxes;
    out.push(s);
  });
  return out;
}

export const TWO_PI = 2 * Math.PI;

/** Angle from `a` to `b` travelling in `dir`, in [0, 2π). */
export function angleTravelled(a: number, b: number, dir: 'cw' | 'ccw'): number {
  let d = dir === 'ccw' ? b - a : a - b;
  d %= TWO_PI;
  if (d < 0) d += TWO_PI;
  return d;
}

/**
 * Points of an arc that bound it: the end points and every axis-extreme (quadrant) point inside
 * the sweep. `from` is the start point; works in any frame.
 */
export function arcExtremes(
  from: { x: number; y: number },
  a: { cx: number; cy: number; r: number; sweep: number; dir: 'cw' | 'ccw' },
): { x: number; y: number }[] {
  const a0 = Math.atan2(from.y - a.cy, from.x - a.cx);
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const q = (k * Math.PI) / 2;
    if (angleTravelled(a0, q, a.dir) <= a.sweep) {
      out.push({ x: a.cx + a.r * Math.cos(q), y: a.cy + a.r * Math.sin(q) });
    }
  }
  return out;
}

export function xyDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function fmt(p: P3): string {
  return `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`;
}
