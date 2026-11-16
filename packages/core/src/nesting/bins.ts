/**
 * Free-rectangle bins for the rectangle placer (spec §6.2, D-019): MaxRects (Jylänki) and a
 * guillotine variant. Each bin works in its own frame of "inflated" rectangles: callers inflate
 * parts and obstacles by the spacing before asking. Pure and deterministic: iteration order is the
 * insertion order and ties keep the first candidate.
 */
import { EPS } from '../geometry/constants';
import type { Rect } from './types';

/** A candidate position: lower `score` (compared lexicographically) is better. */
export interface Fit {
  x: number;
  y: number;
  score: readonly [number, number];
}

export type FitRule = 'bssf' | 'baf' | 'bl';

export interface Bin {
  /** Best position for a w × h rectangle, or null when it fits nowhere. */
  find(w: number, h: number): Fit | null;
  /** Marks a rectangle as used (a placed part or an obstacle). */
  occupy(r: Rect): void;
}

/** Lexicographic comparison of two scores; negative when `a` is better. */
export function compareScore(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

function score(rule: FitRule, free: Rect, w: number, h: number): [number, number] {
  const dw = free.w - w;
  const dh = free.h - h;
  const short = Math.min(dw, dh);
  const long = Math.max(dw, dh);
  switch (rule) {
    case 'bssf':
      return [short, long];
    case 'baf':
      return [free.w * free.h - w * h, short];
    case 'bl':
      // Lowest top edge first, then leftmost.
      return [free.y + h, free.x];
  }
}

function bestIn(frees: readonly Rect[], rule: FitRule, w: number, h: number): Fit | null {
  let best: Fit | null = null;
  for (const f of frees) {
    if (w > f.w + EPS || h > f.h + EPS) continue;
    const s = score(rule, f, w, h);
    if (best === null || compareScore(s, best.score) < 0) best = { x: f.x, y: f.y, score: s };
  }
  return best;
}

/** True when the two rectangles overlap by more than EPS on both axes. */
function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
  );
}

/** Keeps only rectangles with both sides above EPS. */
function pushIfReal(out: Rect[], r: Rect): void {
  if (r.w > EPS && r.h > EPS) out.push(r);
}

/**
 * MaxRects bin: the free list holds every maximal free rectangle (they may overlap). Placing a
 * rectangle splits each free rectangle it touches into up to four maximal pieces; pieces contained
 * in another free rectangle are dropped.
 */
export class MaxRectsBin implements Bin {
  private free: Rect[];

  constructor(
    area: Rect,
    private readonly rule: FitRule,
  ) {
    this.free = area.w > EPS && area.h > EPS ? [{ ...area }] : [];
  }

  find(w: number, h: number): Fit | null {
    return bestIn(this.free, this.rule, w, h);
  }

  occupy(u: Rect): void {
    const kept: Rect[] = [];
    const created: Rect[] = [];
    for (const f of this.free) {
      if (!intersects(f, u)) {
        kept.push(f);
        continue;
      }
      const fr = f.x + f.w;
      const ft = f.y + f.h;
      const ur = u.x + u.w;
      const ut = u.y + u.h;
      if (u.x > f.x) pushIfReal(created, { x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (ur < fr) pushIfReal(created, { x: ur, y: f.y, w: fr - ur, h: f.h });
      if (u.y > f.y) pushIfReal(created, { x: f.x, y: f.y, w: f.w, h: u.y - f.y });
      if (ut < ft) pushIfReal(created, { x: f.x, y: ut, w: f.w, h: ft - ut });
    }
    // Untouched rectangles were maximal before and a new piece lies inside a split one, so only the
    // new pieces can be redundant: drop each one contained in a kept or an earlier-kept new piece.
    const fresh: Rect[] = [];
    created.forEach((c, i) => {
      if (kept.some((k) => contains(k, c))) return;
      const redundant = created.some(
        (o, j) => j !== i && contains(o, c) && (!contains(c, o) || j < i),
      );
      if (!redundant) fresh.push(c);
    });
    this.free = [...kept, ...fresh];
  }
}

/**
 * Guillotine bin: disjoint free rectangles. A placement takes the bottom-left corner of a free
 * rectangle and splits the rest along the shorter leftover axis, so every cut runs edge to edge.
 * Obstacles (locked placements) cut every free rectangle they touch into disjoint pieces.
 */
export class GuillotineBin implements Bin {
  private free: Rect[];

  constructor(
    area: Rect,
    private readonly rule: Exclude<FitRule, 'bl'>,
  ) {
    this.free = area.w > EPS && area.h > EPS ? [{ ...area }] : [];
  }

  find(w: number, h: number): Fit | null {
    return bestIn(this.free, this.rule, w, h);
  }

  occupy(u: Rect): void {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (!intersects(f, u)) {
        next.push(f);
        continue;
      }
      const fr = f.x + f.w;
      const ft = f.y + f.h;
      const ur = u.x + u.w;
      const ut = u.y + u.h;
      if (u.x <= f.x + EPS && u.y <= f.y + EPS) {
        // Placed at the corner (the normal case): split along the shorter leftover axis.
        const wRem = fr - ur;
        const hRem = ft - ut;
        const usedW = Math.min(ur, fr) - f.x;
        const usedH = Math.min(ut, ft) - f.y;
        if (wRem <= hRem) {
          pushIfReal(next, { x: ur, y: f.y, w: wRem, h: usedH });
          pushIfReal(next, { x: f.x, y: ut, w: f.w, h: hRem });
        } else {
          pushIfReal(next, { x: ur, y: f.y, w: wRem, h: f.h });
          pushIfReal(next, { x: f.x, y: ut, w: usedW, h: hRem });
        }
        continue;
      }
      // An obstacle anywhere inside: full-height side strips, then middle strips below and above.
      const midL = Math.max(f.x, u.x);
      const midR = Math.min(fr, ur);
      if (u.x > f.x) pushIfReal(next, { x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (ur < fr) pushIfReal(next, { x: ur, y: f.y, w: fr - ur, h: f.h });
      if (u.y > f.y) pushIfReal(next, { x: midL, y: f.y, w: midR - midL, h: u.y - f.y });
      if (ut < ft) pushIfReal(next, { x: midL, y: ut, w: midR - midL, h: ft - ut });
    }
    this.free = next;
  }
}
