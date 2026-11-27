import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JOIN_TOL } from '../geometry/constants';
import { contour, orientation, signedArea } from '../geometry/polyline';
import { arcOf, segmentMidpoint } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';
import {
  ARC_MAX_SWEEP,
  ARC_MIN_SWEEP,
  angleOf,
  arcAround,
  bulgeFree,
  clampBulge,
  clampSweep,
  tangentArc,
  unwrapSweep,
  bulgeFromRadius,
  bulgeFromSagitta,
  bulgeThrough,
  circleOutline,
  closePath,
  nextPartName,
  nextVertex,
  placeOutline,
  rectFromCorners,
  rectFromSize,
  tidy,
} from './draw';

const coord = fc.double({ min: -5000, max: 5000, noNaN: true });
const pt = fc.record({ x: coord, y: coord });

describe('drawing-tool geometry (T127–T129)', () => {
  it('rectFromCorners: any two corners give the same rectangle', () => {
    expect(rectFromCorners({ x: 100, y: 50 }, { x: 0, y: 200 })).toEqual({
      x: 0,
      y: 50,
      w: 100,
      h: 150,
    });
    fc.assert(
      fc.property(pt, pt, (a, b) => {
        expect(rectFromCorners(a, b)).toEqual(rectFromCorners(b, a));
      }),
    );
  });

  it('rectFromSize keeps the clicked corner and grows towards the cursor', () => {
    expect(rectFromSize({ x: 10, y: 10 }, { x: 50, y: 50 }, 596, 716)).toEqual({
      x: 10,
      y: 10,
      w: 596,
      h: 716,
    });
    expect(rectFromSize({ x: 10, y: 10 }, { x: -5, y: -5 }, 100, 20)).toEqual({
      x: -90,
      y: -10,
      w: 100,
      h: 20,
    });
  });

  it('circleOutline is a CCW closed contour of radius r in the box 0..2r', () => {
    const vs = circleOutline(150);
    const poly = contour(vs);
    expect(orientation(poly)).toBe('ccw');
    expect(signedArea(poly)).toBeCloseTo(Math.PI * 150 * 150, 6);
    const [v0, v1] = vs as [Vertex, Vertex];
    const a = arcOf(v0, v1, v0.bulge);
    expect(a?.radius).toBeCloseTo(150, 9);
  });

  it('nextVertex: typed length along the cursor direction, typed angle, 45° lock', () => {
    const o = { x: 0, y: 0 };
    expect(nextVertex(o, { x: 7, y: 3 })).toEqual({ x: 7, y: 3 });
    expect(nextVertex(o, { x: 10, y: 0 }, { length: 600 })).toEqual({ x: 600, y: 0 });
    expect(nextVertex(o, { x: 1, y: 1 }, { length: 100, angle: 90 })).toEqual({ x: 0, y: 100 });
    const locked = nextVertex(o, { x: 100, y: 8 }, { lock: true });
    expect(locked).toEqual({ x: 100, y: 0 });
    const diag = nextVertex(o, { x: 100, y: 90 }, { lock: true, length: 10 });
    expect(diag.x).toBeCloseTo(Math.SQRT1_2 * 10, 6);
    expect(diag.y).toBeCloseTo(Math.SQRT1_2 * 10, 6);
    expect(angleOf(o, { x: 0, y: -1 })).toBe(270);
  });

  it('nextVertex with a typed length lands exactly that far away', () => {
    fc.assert(
      fc.property(pt, pt, fc.double({ min: 1, max: 3000, noNaN: true }), (a, c, len) => {
        fc.pre(Math.hypot(c.x - a.x, c.y - a.y) > 1e-3);
        const p = nextVertex(a, c, { length: len });
        expect(Math.hypot(p.x - a.x, p.y - a.y)).toBeCloseTo(len, 4);
      }),
    );
  });

  it('L-shape by typed lengths closes into a CCW part with exact sizes', () => {
    const lens: [number, number][] = [
      [600, 0],
      [300, 90],
      [300, 180],
      [300, 90],
      [300, 180],
    ];
    const pts = [{ x: 0, y: 0 }];
    for (const [length, angle] of lens) {
      pts.push(nextVertex(pts[pts.length - 1] as Point, { x: 0, y: 0 }, { length, angle }));
    }
    // back to start: the last vertex closes onto the first
    pts.push({ x: 0, y: 0 });
    const closed = closePath(pts.map((p) => ({ ...p, bulge: 0 })));
    expect(closed).toBeDefined();
    const placed = placeOutline(closed as Vertex[]);
    expect(placed.at).toEqual({ x: 0, y: 0 });
    expect(placed.outline.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [600, 0],
      [600, 300],
      [300, 300],
      [300, 600],
      [0, 600],
    ]);
    expect(signedArea(contour(placed.outline))).toBeCloseTo(600 * 300 + 300 * 300, 6);
  });

  it('closePath joins within JOIN_TOL and refuses open paths', () => {
    const sq = [
      { x: 0, y: 0, bulge: 0 },
      { x: 100, y: 0, bulge: 0 },
      { x: 100, y: 100, bulge: 0 },
      { x: JOIN_TOL / 2, y: 0, bulge: 0 },
    ];
    expect(closePath(sq)?.length).toBe(3);
    expect(closePath([...sq.slice(0, 3), { x: 1, y: 0, bulge: 0 }])).toBeUndefined();
    expect(closePath(sq.slice(0, 2))).toBeUndefined();
  });

  it('placeOutline normalises CW input to CCW in a local frame at the box corner', () => {
    const cw = [
      { x: 100, y: 100, bulge: 0 },
      { x: 100, y: 300, bulge: 0 },
      { x: 400, y: 300, bulge: 0 },
      { x: 400, y: 100, bulge: 0 },
    ];
    const r = placeOutline(cw);
    expect(r.at).toEqual({ x: 100, y: 100 });
    expect(orientation(contour(r.outline))).toBe('ccw');
    expect(Math.min(...r.outline.map((v) => v.x))).toBe(0);
  });

  it('bulgeThrough: the arc passes through the third point', () => {
    fc.assert(
      fc.property(
        pt,
        pt,
        fc.double({ min: 0.05, max: 3, noNaN: true }),
        fc.boolean(),
        (a, b, k, s) => {
          const c = Math.hypot(b.x - a.x, b.y - a.y);
          fc.pre(c > 1);
          const bulge = s ? k : -k;
          const mid = segmentMidpoint(a, b, bulge);
          const found = bulgeThrough(a, mid, b);
          expect(found).toBeCloseTo(bulge, 5);
        },
      ),
    );
    expect(bulgeThrough({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })).toBe(0);
    // semicircle below the chord (right of travel) = +1
    expect(bulgeThrough({ x: 0, y: 0 }, { x: 5, y: -5 }, { x: 10, y: 0 })).toBeCloseTo(1, 9);
  });

  it('bulgeFromSagitta: the segment middle follows the dragged point', () => {
    fc.assert(
      fc.property(pt, pt, fc.double({ min: -2, max: 2, noNaN: true }), (a, b, k) => {
        const c = Math.hypot(b.x - a.x, b.y - a.y);
        fc.pre(c > 1 && Math.abs(k) > 1e-6);
        const m = segmentMidpoint(a, b, k);
        expect(bulgeFromSagitta(a, b, m)).toBeCloseTo(k, 5);
      }),
    );
  });

  it('bulgeFromRadius: arc radius equals the typed radius; too small is refused', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 300, y: 0 };
    const bulge = bulgeFromRadius(a, b, 250, true);
    expect(bulge).toBeGreaterThan(0);
    expect(arcOf(a, b, bulge as number)?.radius).toBeCloseTo(250, 9);
    expect(bulgeFromRadius(a, b, 250, false)).toBeCloseTo(-(bulge as number), 12);
    expect(bulgeFromRadius(a, b, 100, true)).toBeUndefined();
    expect(bulgeFromRadius(a, b, 150, true)).toBeCloseTo(1, 9);
  });

  it('tidy removes float dust and negative zero', () => {
    expect(tidy(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(tidy(-0.0000000001), 0)).toBe(true);
  });

  it('nextPartName takes the next free number', () => {
    expect(nextPartName('Parça {n}', ['A', 'B', 'C', 'D', 'E'])).toBe('Parça 6');
    expect(nextPartName('Parça {n}', ['Parça 2', 'x'])).toBe('Parça 3');
    expect(nextPartName('Parça {n}', ['Parça 3', 'x'])).toBe('Parça 4');
  });
});

describe('T382 flexible arc constructions', () => {
  const coord = fc.double({ min: -500, max: 500, noNaN: true });
  const pt = fc.record({ x: coord, y: coord });
  const onCircle = (c: Point, r: number, p: Point) =>
    Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r);
  const side = (a: Point, b: Point, p: Point) =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

  it('3-point arc: start, the point on the arc and the end lie on one circle; sweep sign follows the side', () => {
    fc.assert(
      fc.property(pt, pt, pt, (a, m, b) => {
        const s = side(a, b, m);
        fc.pre(Math.hypot(b.x - a.x, b.y - a.y) > 1 && Math.abs(s) > 50);
        fc.pre(Math.hypot(m.x - a.x, m.y - a.y) > 1 && Math.hypot(m.x - b.x, m.y - b.y) > 1);
        const bulge = bulgeThrough(a, m, b);
        const arc = arcOf(a, b, bulge);
        expect(arc).toBeDefined();
        if (!arc) return;
        const tol = 1e-6 * Math.max(1, arc.radius);
        expect(onCircle(arc.center, arc.radius, a)).toBeLessThan(tol);
        expect(onCircle(arc.center, arc.radius, b)).toBeLessThan(tol);
        expect(onCircle(arc.center, arc.radius, m)).toBeLessThan(tol);
        // m right of the chord → CCW (bulge > 0), left → CW.
        expect(Math.sign(bulge)).toBe(s < 0 ? 1 : -1);
      }),
    );
  });

  it('sehim mode: the arc middle sits at the cursor offset, any sweep up to 359°, both sides', () => {
    fc.assert(
      fc.property(pt, pt, coord, (a, b, h) => {
        const c = Math.hypot(b.x - a.x, b.y - a.y);
        fc.pre(c > 1 && Math.abs(h) > 0.01);
        // Cursor on the perpendicular bisector, h right of the chord.
        const m = {
          x: (a.x + b.x) / 2 + ((b.y - a.y) / c) * h,
          y: (a.y + b.y) / 2 - ((b.x - a.x) / c) * h,
        };
        const bulge = bulgeFree(a, b, m);
        expect(bulge).toBeDefined();
        if (bulge === undefined) return;
        expect(Math.sign(bulge)).toBe(Math.sign(h));
        const sweep = Math.abs(4 * Math.atan(bulge));
        expect(sweep).toBeGreaterThanOrEqual(ARC_MIN_SWEEP - 1e-12);
        expect(sweep).toBeLessThanOrEqual(ARC_MAX_SWEEP + 1e-12);
        const arc = arcOf(a, b, bulge);
        if (!arc) return;
        const tol = 1e-6 * Math.max(1, arc.radius);
        expect(onCircle(arc.center, arc.radius, a)).toBeLessThan(tol);
        expect(onCircle(arc.center, arc.radius, b)).toBeLessThan(tol);
        const k = Math.abs(2 * h) / c;
        if (k < Math.tan(ARC_MAX_SWEEP / 4) && k > Math.tan(ARC_MIN_SWEEP / 4)) {
          const mid = segmentMidpoint(a, b, bulge);
          expect(Math.hypot(mid.x - m.x, mid.y - m.y)).toBeLessThan(
            1e-6 * Math.max(1, Math.abs(h), c),
          );
        }
      }),
    );
  });

  it('sehim mode: typed sweep and radius fix the arc, the cursor gives the side', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const below = { x: 50, y: -10 }; // right of a → b: CCW
    const above = { x: 50, y: 10 };
    expect(4 * Math.atan(bulgeFree(a, b, below, { sweep: 270 }) ?? 0)).toBeCloseTo(
      (3 * Math.PI) / 2,
      9,
    );
    expect(4 * Math.atan(bulgeFree(a, b, above, { sweep: 90 }) ?? 0)).toBeCloseTo(-Math.PI / 2, 9);
    const r = arcOf(a, b, bulgeFree(a, b, above, { r: 80 }) ?? 0);
    expect(r?.radius).toBeCloseTo(80, 9);
    // Cursor past the half circle: the major arc of the same radius.
    const major = bulgeFree(a, b, { x: 50, y: -90 }, { r: 80 }) ?? 0;
    expect(Math.abs(4 * Math.atan(major))).toBeGreaterThan(Math.PI);
    expect(arcOf(a, b, major)?.radius).toBeCloseTo(80, 9);
    expect(bulgeFree(a, b, above, { r: 10 })).toBeUndefined(); // R < chord / 2
    expect(bulgeFree(a, a, above)).toBeUndefined();
    expect(bulgeFree(a, b, { x: 30, y: 0 })).toBeUndefined(); // on the chord: a line
  });

  it('tangent arc: leaves along the line direction, end on the circle, through the cursor', () => {
    fc.assert(
      fc.property(pt, fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), pt, (p, ang, q) => {
        const dir = { x: Math.cos(ang), y: Math.sin(ang) };
        const h = (q.x - p.x) * -dir.y + (q.y - p.y) * dir.x;
        fc.pre(Math.abs(h) > 1);
        const arc = tangentArc(p, dir, q);
        expect(arc).toBeDefined();
        if (!arc) return;
        // Centre is perpendicular to the tangent at p.
        const cx = arc.center.x - p.x;
        const cy = arc.center.y - p.y;
        expect(Math.abs(cx * dir.x + cy * dir.y)).toBeLessThan(1e-6 * Math.max(1, arc.radius));
        const tol = 1e-5 * Math.max(1, arc.radius);
        expect(onCircle(arc.center, arc.radius, q)).toBeLessThan(tol);
        expect(onCircle(arc.center, arc.radius, arc.end)).toBeLessThan(tol);
        // Turn left (cursor left of the tangent) → CCW.
        expect(Math.sign(arc.bulge)).toBe(h > 0 ? 1 : -1);
        // The bulge segment p → end is that same arc.
        const seg = arcOf(p, arc.end, arc.bulge);
        if (seg && Math.abs(4 * Math.atan(arc.bulge)) < ARC_MAX_SWEEP - 1e-6) {
          expect(Math.abs(seg.radius - arc.radius)).toBeLessThan(tol * 10);
        }
      }),
    );
  });

  it('tangent arc: typed radius and sweep', () => {
    const arc = tangentArc({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 5 }, { r: 50, sweep: 90 });
    expect(arc?.center).toEqual({ x: 0, y: 50 });
    expect(arc?.end).toEqual({ x: 50, y: 50 });
    expect(arc?.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    const cw = tangentArc({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: -5 }, { r: 50, sweep: 90 });
    expect(cw?.end).toEqual({ x: 50, y: -50 });
    expect(cw?.bulge).toBeLessThan(0);
    expect(tangentArc({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 })).toBeUndefined();
  });

  it('centre mode: unwrapped sweep follows the mouse past 180° in both directions', () => {
    const c = { x: 0, y: 0 };
    const s = { x: 10, y: 0 };
    let sweep = 0;
    for (let deg = 5; deg <= 300; deg += 5) {
      const r = (deg * Math.PI) / 180;
      sweep = unwrapSweep(c, s, { x: 10 * Math.cos(r), y: 10 * Math.sin(r) }, sweep);
    }
    expect(sweep).toBeCloseTo((300 * Math.PI) / 180, 9);
    sweep = 0;
    for (let deg = -5; deg >= -200; deg -= 5) {
      const r = (deg * Math.PI) / 180;
      sweep = unwrapSweep(c, s, { x: 10 * Math.cos(r), y: 10 * Math.sin(r) }, sweep);
    }
    expect(sweep).toBeCloseTo((-200 * Math.PI) / 180, 9);
    const arc = arcAround(c, s, Math.PI / 2);
    expect(arc?.end).toEqual({ x: 0, y: 10 });
    expect(arc?.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    expect(arcAround(c, c, 1)).toBeUndefined();
    expect(clampSweep(2 * Math.PI)).toBeCloseTo(ARC_MAX_SWEEP, 12);
    expect(clampSweep(-1e-6)).toBeCloseTo(-ARC_MIN_SWEEP, 12);
    expect(clampBulge(0)).toBe(0);
  });
});
