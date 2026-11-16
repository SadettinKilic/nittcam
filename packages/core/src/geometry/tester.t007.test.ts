/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index results whose length is asserted */
/**
 * Tester T007: hand-computed expectations, independent of the implementation.
 * Sign convention (D-013): d > 0 = right of travel; outer CCW grows, inner CW shrinks.
 */
import { describe, expect, it } from 'vitest';
import { rectOutline } from '../schema/outline';
import { EPS } from './constants';
import { offset, type OffsetResult } from './offset';
import { contour, reverse, signedArea } from './polyline';
import { transform, type QuarterTurn } from './transform';
import type { Polyline, Vertex } from './types';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const poly = (...vs: Vertex[]): Polyline => contour(vs);
const PI = Math.PI;

function ok(r: OffsetResult): Polyline[] {
  if (!r.ok) throw new Error(`offset failed: ${r.reason} ${r.message}`);
  return r.polylines;
}

/** Radius of each arc segment from chord and bulge: r = c (1 + b^2) / (4 |b|). */
function arcRadii(p: Polyline): number[] {
  const out: number[] = [];
  p.vertices.forEach((a, i) => {
    if (a.bulge === 0) return;
    const b = p.vertices[(i + 1) % p.vertices.length]!;
    const c = Math.hypot(b.x - a.x, b.y - a.y);
    out.push((c * (1 + a.bulge ** 2)) / (4 * Math.abs(a.bulge)));
  });
  return out;
}
const lines = (p: Polyline) => p.vertices.filter((q) => q.bulge === 0).length;
const noNaN = (ps: Polyline[]) =>
  ps.every((p) => p.vertices.every((q) => [q.x, q.y, q.bulge].every(Number.isFinite)));

const rect = (w: number, h: number) => poly(v(0, 0), v(w, 0), v(w, h), v(0, h)); // CCW
const rr = (w: number, h: number, r: number) => contour(rectOutline({ w, h, r }));

describe('tester T007: hand-computed offsets', () => {
  it('rect 100x50 +3 outward: 106x56 rounded rect, 4 arcs r=3, bulge tan(22.5 deg)', () => {
    const [o] = ok(offset(rect(100, 50), 3));
    expect(o!.vertices).toHaveLength(8);
    expect(lines(o!)).toBe(4);
    for (const r of arcRadii(o!)) expect(r).toBeCloseTo(3, 9);
    for (const q of o!.vertices.filter((x) => x.bulge))
      expect(q.bulge).toBeCloseTo(Math.tan(PI / 8), 12);
    const xs = o!.vertices.map((q) => q.x);
    const ys = o!.vertices.map((q) => q.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(106, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(56, 9);
    expect(signedArea(o!)).toBeCloseTo(100 * 50 + 2 * 3 * (100 + 50) + PI * 9, 9);
  });

  it('window (inner CW) 40x40 +3 inward: sharp 34x34 square, area 1156', () => {
    const [o] = ok(offset(reverse(rect(40, 40)), 3));
    expect(o!.vertices).toHaveLength(4);
    expect(o!.vertices.every((q) => q.bulge === 0)).toBe(true);
    expect(signedArea(o!)).toBeCloseTo(-1156, 9);
    const xs = o!.vertices.map((q) => q.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(3, 9);
    expect(xs[3]).toBeCloseTo(37, 9);
  });

  it('rounded rect r=10: inward 3 gives r=7, outward 3 gives r=13', () => {
    const base = rr(80, 60, 10);
    const inward = ok(offset(base, -3))[0]!;
    const outward = ok(offset(base, 3))[0]!;
    expect(arcRadii(inward)).toHaveLength(4);
    for (const r of arcRadii(inward)) expect(r).toBeCloseTo(7, 9);
    expect(arcRadii(outward)).toHaveLength(4);
    for (const r of arcRadii(outward)) expect(r).toBeCloseTo(13, 9);
    const cw = ok(offset(reverse(base), 3))[0]!;
    for (const r of arcRadii(cw)) expect(r).toBeCloseTo(7, 9);
    // rounded rect area = w*h - (4 - pi) r^2
    expect(signedArea(inward)).toBeCloseTo(74 * 54 - (4 - PI) * 49, 8);
    expect(signedArea(outward)).toBeCloseTo(86 * 66 - (4 - PI) * 169, 8);
  });

  it('circle r=20: +5 gives r=25, -5 gives r=15, inward >= 20 collapses', () => {
    const c = poly(v(-20, 0, 1), v(20, 0, 1));
    const area = (p: Polyline) => Math.abs(signedArea(p));
    const out = ok(offset(c, 5))[0]!;
    expect(arcRadii(out).every((r) => Math.abs(r - 25) < 1e-9)).toBe(true);
    expect(area(out)).toBeCloseTo(PI * 625, 6);
    const inn = ok(offset(c, -5))[0]!;
    expect(arcRadii(inn).every((r) => Math.abs(r - 15) < 1e-9)).toBe(true);
    expect(area(inn)).toBeCloseTo(PI * 225, 6);
    for (const d of [-20, -20.5, -25, -1000]) {
      const r = offset(c, d);
      expect(r.ok, `d=${d}`).toBe(false);
      if (!r.ok) expect(r.reason).toBe('COLLAPSED');
    }
    expect(offset(c, -19.9).ok).toBe(true);
  });

  it('inner contour with corner r=2, tool r=3: ARC_COLLAPSED warning', () => {
    const hole = reverse(rr(40, 40, 2));
    const r = offset(hole, 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toContain('ARC_COLLAPSED');
      expect(noNaN(r.polylines)).toBe(true);
      expect(Math.abs(signedArea(r.polylines[0]!))).toBeCloseTo(34 * 34, 6);
    }
    const fit = offset(reverse(rr(40, 40, 3)), 3);
    expect(fit.ok && fit.warnings.includes('ARC_COLLAPSED')).toBe(false);
    const roomy = offset(reverse(rr(40, 40, 5)), 3);
    expect(roomy.ok && roomy.warnings.length).toBe(0);
  });

  it('dumbbell inward: SPLIT flag with two loops', () => {
    // two 30x30 squares joined by a 20 long, 4 high neck (CCW)
    const db = poly(
      v(0, 0),
      v(30, 0),
      v(30, 13),
      v(50, 13),
      v(50, 0),
      v(80, 0),
      v(80, 30),
      v(50, 30),
      v(50, 17),
      v(30, 17),
      v(30, 30),
      v(0, 30),
    );
    expect(signedArea(db)).toBeGreaterThan(0);
    const r = offset(db, -3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toContain('SPLIT');
      expect(r.polylines).toHaveLength(2);
      // 24x24 core plus the round-join bulge at the neck corners: between 576 and 590
      const [a, b] = r.polylines.map((p) => signedArea(p)) as [number, number];
      expect(a).toBeGreaterThan(576);
      expect(a).toBeLessThan(590);
      expect(a).toBeCloseTo(b, 6);
    }
    const r2 = offset(db, -1.5);
    expect(r2.ok && r2.warnings.includes('SPLIT')).toBe(false);
  });

  it('invalid inputs return ok:false with the right reason, never throw / NaN', () => {
    const sq = rect(10, 10);
    for (const d of [Number.NaN, Infinity, -Infinity]) {
      const r = offset(sq, d);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('INVALID_DISTANCE');
    }
    const open = offset({ vertices: sq.vertices, closed: false }, 1);
    expect(open.ok === false && open.reason).toBe('NOT_CLOSED');
    const bow = offset(poly(v(0, 0), v(10, 10), v(10, 0), v(0, 10)), 1);
    expect(bow.ok === false && bow.reason).toBe('SELF_INTERSECTING');
    const flat = offset(poly(v(0, 0), v(5, 0), v(10, 0)), 1);
    expect(flat.ok === false && ['DEGENERATE', 'SELF_INTERSECTING'].includes(flat.reason)).toBe(
      true,
    );
    expect(offset(poly(v(0, 0)), 1).ok).toBe(false);
    expect(offset(poly(), 1).ok).toBe(false);
    expect(offset(poly(v(0, 0), v(0, 0), v(0, 0)), 1).ok).toBe(false);
  });

  it('d = 0 and |d| < EPS return an unchanged copy (no mutation, no NaN)', () => {
    const sq = rect(10, 10);
    const snap = JSON.stringify(sq);
    const r = offset(sq, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.polylines).toEqual([sq]);
      expect(r.polylines[0]).not.toBe(sq);
    }
    expect(JSON.stringify(sq)).toBe(snap);
    expect(offset(sq, EPS / 2).ok).toBe(true);
  });

  it('does not mutate input; any ok result is finite, also for huge distances', () => {
    const sq = rect(10, 10);
    const snap = JSON.stringify(sq);
    for (const d of [1e-3, 0.5, 4.9, 5, 5.1, 100, 1e6, -0.5, -4.9, -5, -5.1, -100, -1e6]) {
      const r = offset(sq, d);
      if (r.ok) expect(noNaN(r.polylines), `d=${d}`).toBe(true);
    }
    expect(JSON.stringify(sq)).toBe(snap);
    const big = ok(offset(sq, 1e6))[0]!;
    expect(signedArea(big) / (PI * 1e12)).toBeCloseTo(1, 4);
  });

  describe('translation / rotation invariance', () => {
    const L = (w: number) => poly(v(0, 0), v(60, 0), v(60, 20), v(20, 20), v(20, 60), v(0, w));
    const fixtures: Record<string, [Polyline, number][]> = {
      rect: [
        [rect(100, 50), 3],
        [rect(100, 50), -3],
      ],
      rounded: [
        [rr(80, 60, 10), 3],
        [rr(80, 60, 10), -3],
      ],
      circle: [
        [poly(v(-20, 0, 1), v(20, 0, 1)), 5],
        [poly(v(-20, 0, 1), v(20, 0, 1)), -5],
      ],
      hole: [[reverse(rr(40, 40, 2)), 3]],
      lshape: [
        [L(60), 2],
        [L(60), -2],
      ],
    };
    const turns: QuarterTurn[] = [0, 90, 180, 270];
    const sameSet = (a: Polyline, b: Polyline) =>
      a.vertices.length === b.vertices.length &&
      a.vertices.every((p) =>
        b.vertices.some(
          (q) => Math.hypot(p.x - q.x, p.y - q.y) < EPS && Math.abs(p.bulge - q.bulge) < 1e-6,
        ),
      );
    for (const [name, cases] of Object.entries(fixtures))
      for (const [p, d] of cases)
        for (const deg of turns)
          it(`${name} d=${d} rot ${deg} + translate`, () => {
            const t = { rotate: deg, dx: 123.456, dy: -78.9 };
            const base = ok(offset(p, d));
            const moved = ok(offset(transform(p, t), d));
            expect(moved).toHaveLength(base.length);
            base
              .map((b) => transform(b, t))
              .forEach((e, i) => {
                expect(Math.abs(signedArea(moved[i]!) - signedArea(e))).toBeLessThan(1e-6);
                expect(sameSet(moved[i]!, e)).toBe(true);
              });
          });
  });
});
