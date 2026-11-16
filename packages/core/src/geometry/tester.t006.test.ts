/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion -- tests edit raw JSON and index known-length arrays */
/**
 * Tester additions for T006 (PR #7). Expected values are worked out by hand (comments show the
 * arithmetic) and never computed with the implementation's own helpers.
 */
import { describe, expect, it } from 'vitest';
import mixed from '../schema/__fixtures__/mixed.json';
import { parseProject, type Project } from '../schema';
import { partLargerThanSheet } from '../validate';
import {
  arcOf,
  bbox,
  close,
  contour,
  EPS,
  length,
  mirror,
  normalize,
  orientation,
  reverse,
  rotate,
  segmentBBox,
  segmentLength,
  segmentMidpoint,
  signedArea,
  transform,
  translate,
  type Polyline,
} from './index';

const v = (x: number, y: number, bulge = 0) => ({ x, y, bulge });
const HALF_DISC = (Math.PI * 50 * 50) / 2; // semicircle r = 50 -> 3926.99

describe('T006 tester: known arcs', () => {
  // (0,0) -> (100,0), bulge +1: CCW semicircle, centre (50,0), passes through (50,-50) (below).
  const semi = (b: number): Polyline => contour([v(0, 0, b), v(100, 0)]);

  it('bulge +1: area +pi*50^2/2, y in [-50, 0], length 100 + 50pi', () => {
    const p = semi(1);
    expect(signedArea(p)).toBeCloseTo(HALF_DISC, 6);
    expect(orientation(p)).toBe('ccw');
    const b = bbox(p);
    expect(b.minX).toBeCloseTo(0, 9);
    expect(b.maxX).toBeCloseTo(100, 9);
    expect(b.minY).toBeCloseTo(-50, 9);
    expect(b.maxY).toBeCloseTo(0, 9);
    expect(length(p)).toBeCloseTo(100 + 50 * Math.PI, 9); // arc 50pi + closing chord 100
  });

  it('bulge -1: area -pi*50^2/2, y in [0, 50], length 100 + 50pi', () => {
    const p = semi(-1);
    expect(signedArea(p)).toBeCloseTo(-HALF_DISC, 6);
    expect(orientation(p)).toBe('cw');
    const b = bbox(p);
    expect(b.minY).toBeCloseTo(0, 9);
    expect(b.maxY).toBeCloseTo(50, 9);
    expect(length(p)).toBeCloseTo(100 + 50 * Math.PI, 9);
  });

  it('bulge direction: positive = counter-clockwise (DXF); arc midpoint is right of the chord', () => {
    // CCW around centre (50,0) from angle 180 deg (the point (0,0)) goes down through 270 deg
    const m = segmentMidpoint(v(0, 0), v(100, 0), 1);
    expect(m.x).toBeCloseTo(50, 9);
    expect(m.y).toBeCloseTo(-50, 9);
    const arc = arcOf(v(0, 0), v(100, 0), 1);
    expect(arc?.center.x).toBeCloseTo(50, 9);
    expect(arc?.center.y).toBeCloseTo(0, 9);
    expect(arc?.sweep).toBeCloseTo(Math.PI, 12); // positive sweep = CCW
  });

  it('quarter arc, bulge tan(22.5 deg) = sqrt2 - 1: sweep 90 deg, length 25pi, pie area 625pi', () => {
    const b = Math.SQRT2 - 1;
    const arc = arcOf(v(50, 0), v(0, 50), b);
    expect(arc?.sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(arc?.radius).toBeCloseTo(50, 9);
    expect(arc?.center.x).toBeCloseTo(0, 9);
    expect(arc?.center.y).toBeCloseTo(0, 9);
    expect(segmentLength(v(50, 0), v(0, 50), b)).toBeCloseTo(25 * Math.PI, 9);
    const mid = segmentMidpoint(v(50, 0), v(0, 50), b);
    expect(mid.x).toBeCloseTo(25 * Math.SQRT2, 9); // 50 cos 45
    expect(mid.y).toBeCloseTo(25 * Math.SQRT2, 9);
    const pie = contour([v(0, 0), v(50, 0, b), v(0, 50)]);
    expect(signedArea(pie)).toBeCloseTo((Math.PI * 2500) / 4, 6);
    const box = bbox(pie);
    expect([box.minX, box.minY, box.maxX, box.maxY].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([
      0, 0, 50, 50,
    ]);
  });

  it('an arc crossing 0 and 90 deg includes both extremes (CCW and CW forms)', () => {
    // r = 10 about the origin, from -45 to 135 deg CCW (b = +1); same arc as CW from 135 to -45
    const s = 10 / Math.SQRT2;
    for (const [p0, p1, b] of [
      [v(s, -s), v(-s, s), 1],
      [v(-s, s), v(s, -s), -1],
    ] as const) {
      const box = segmentBBox(p0, p1, b);
      expect(box.maxX).toBeCloseTo(10, 9); // 0 deg extreme
      expect(box.maxY).toBeCloseTo(10, 9); // 90 deg extreme
      expect(box.minX).toBeCloseTo(-s, 9); // 180 and 270 deg are not in the sweep
      expect(box.minY).toBeCloseTo(-s, 9);
    }
  });

  it('an arc crossing 180 and 270 deg (CCW 135 -> 315 deg) includes both extremes', () => {
    const s = 10 / Math.SQRT2;
    const box = segmentBBox(v(-s, s), v(s, -s), 1);
    expect(box.minX).toBeCloseTo(-10, 9);
    expect(box.minY).toBeCloseTo(-10, 9);
    expect(box.maxX).toBeCloseTo(s, 9);
    expect(box.maxY).toBeCloseTo(s, 9);
  });
});

describe('T006 tester: reverse', () => {
  // segment midpoints by hand: chord mid + b*(dy, -dx)/2
  //   s0 (0,0)->(100,0)     b=0.5  : (50,0)  + 0.5*(0,-100)/2     = (50,-25)
  //   s1 (100,0)->(100,100) line   : (100,50)
  //   s2 (100,100)->(0,100) b=-0.3 : (50,100) + (-0.3)*(0,100)/2  = (50,85)
  //   s3 (0,100)->(0,0)     b=0.2  : (0,50)   + 0.2*(-100,0)/2    = (-10,50)
  const shape = contour([v(0, 0, 0.5), v(100, 0, 0), v(100, 100, -0.3), v(0, 100, 0.2)]);
  const byXY = (p: number[], q: number[]) => p[0]! - q[0]! || p[1]! - q[1]!;
  const expected = [
    [50, -25],
    [100, 50],
    [50, 85],
    [-10, 50],
  ].sort(byXY);

  const mids = (p: Polyline) => {
    const n = p.vertices.length;
    return p.vertices
      .map((a, i) => {
        const b = p.vertices[(i + 1) % n]!;
        const m = segmentMidpoint(a, b, a.bulge);
        return [Math.round(m.x * 1e6) / 1e6, Math.round(m.y * 1e6) / 1e6];
      })
      .sort(byXY);
  };

  it('original midpoints match the hand values', () => {
    expect(mids(shape)).toEqual(expected);
  });

  it('reversed segments occupy the same geometry, orientation flips, area negates', () => {
    const r = reverse(shape);
    expect(mids(r)).toEqual(expected);
    expect(signedArea(r)).toBeCloseTo(-signedArea(shape), 9);
    expect(length(r)).toBeCloseTo(length(shape), 9);
    expect(orientation(r)).not.toBe(orientation(shape));
    expect(reverse(r)).toEqual(shape);
  });
});

describe('T006 tester: transform', () => {
  const messy = contour([
    v(0.1, 0.2, 0.3),
    v(33.3, -7.7, -0.4),
    v(12.5, 99.9, 0),
    v(-1e-3, 5, 0.7),
  ]);

  it('rotate 90 deg four times is exactly the original (no drift), also after 400 more turns', () => {
    let p: Polyline = messy;
    for (let i = 0; i < 4; i++) p = rotate(p, 90);
    p.vertices.forEach((q, i) => {
      const o = messy.vertices[i]!;
      expect(q.x === o.x && q.y === o.y && q.bulge === o.bulge).toBe(true);
    });
    for (let i = 0; i < 400; i++) p = rotate(p, 90);
    p.vertices.forEach((q, i) => {
      expect(q.x === messy.vertices[i]!.x && q.y === messy.vertices[i]!.y).toBe(true);
    });
  });

  it('rotation keeps area and length', () => {
    for (const deg of [90, 180, 270] as const) {
      const r = rotate(messy, deg);
      expect(signedArea(r)).toBeCloseTo(signedArea(messy), 9);
      expect(length(r)).toBeCloseTo(length(messy), 9);
    }
  });

  it('mirror flips an outer CCW contour to CW; normalize restores CCW with the same area', () => {
    const rect = contour([v(0, 0), v(100, 0), v(100, 50), v(0, 50)]);
    const arch = contour([v(0, 0), v(100, 0), v(100, 50, 1), v(0, 50)]);
    for (const poly of [rect, arch]) {
      for (const axis of ['x', 'y'] as const) {
        const m = mirror(poly, axis);
        expect(orientation(m)).toBe('cw');
        expect(signedArea(m)).toBeCloseTo(-signedArea(poly), 9);
        const n = normalize(m, 'outer');
        expect(orientation(n)).toBe('ccw');
        expect(signedArea(n)).toBeCloseTo(signedArea(poly), 9);
      }
    }
  });

  it('mirror of the arch moves its bulge to the mirrored side (hand check)', () => {
    // top arc (100,50)->(0,50) b=1 bulges up (right of leftward travel): maxY = 50 + 50 = 100
    const arch = contour([v(0, 0), v(100, 0), v(100, 50, 1), v(0, 50)]);
    expect(bbox(arch).maxY).toBeCloseTo(100, 9);
    const m = mirror(arch, 'y');
    expect(bbox(m).minY).toBeCloseTo(-100, 9);
    expect(bbox(m).maxY).toBeCloseTo(0, 9);
  });

  it('transform() = mirror, then rotate, then translate (hand-computed point)', () => {
    // (10,0): mirror x -> (-10,0); rotate 90 CCW -> (0,-10); translate (5,7) -> (5,-3)
    const out = transform(contour([v(10, 0), v(20, 0), v(20, 5)]), {
      mirror: 'x',
      rotate: 90,
      dx: 5,
      dy: 7,
    });
    expect(out.vertices[0]).toEqual({ x: 5, y: -3, bulge: 0 });
  });

  it('does not mutate inputs', () => {
    const snap = JSON.stringify(messy);
    rotate(messy, 90);
    mirror(messy, 'x');
    translate(messy, 1, 2);
    reverse(messy);
    normalize(messy, 'inner');
    expect(JSON.stringify(messy)).toBe(snap);
  });
});

describe('T006 tester: degenerates stay finite', () => {
  // JSON.stringify turns NaN and Infinity into null, so a clean string proves finite numbers
  const finite = (x: unknown) => {
    expect(JSON.stringify(x)).not.toMatch(/null|NaN|Infinity/);
  };
  const everything = (p: Polyline) => {
    finite({
      area: signedArea(p),
      len: length(p),
      rev: reverse(p),
      nOuter: normalize(p, 'outer'),
      nInner: normalize(p, 'inner'),
      closed: close(p),
      rot: rotate(p, 90),
      mir: mirror(p, 'x'),
    });
    if (p.vertices.length > 0) finite(bbox(p));
    expect(['ccw', 'cw', 'none']).toContain(orientation(p));
  };

  it('zero-length segment, with and without a bulge', () => {
    everything(contour([v(0, 0), v(10, 0, 1), v(10, 0), v(10, 10), v(0, 10)]));
    everything(contour([v(0, 0), v(10, 0, -0.5), v(10, 0), v(10, 10), v(0, 10)]));
    // the zero-length arc must not change the measures of the underlying square
    const sq = contour([v(0, 0), v(10, 0, 1), v(10, 0), v(10, 10), v(0, 10)]);
    expect(signedArea(sq)).toBeCloseTo(100, 9);
    expect(length(sq)).toBeCloseTo(40, 9);
  });

  it('duplicate consecutive vertices (also first = last, all identical)', () => {
    everything(contour([v(0, 0), v(0, 0), v(10, 0), v(10, 10), v(10, 10), v(0, 10)]));
    everything(contour([v(0, 0), v(10, 0), v(10, 10), v(0, 10), v(0, 0)]));
    everything(contour([v(5, 5), v(5, 5), v(5, 5)]));
    expect(orientation(contour([v(5, 5), v(5, 5), v(5, 5)]))).toBe('none');
  });

  it('a 2-vertex closed polyline: line pair has zero area, with a bulge it is a circle', () => {
    const flat = contour([v(0, 0), v(10, 0)]);
    everything(flat);
    expect(signedArea(flat)).toBe(0);
    expect(orientation(flat)).toBe('none');
    expect(length(flat)).toBeCloseTo(20, 12);
    const disc = contour([v(0, 0, 1), v(10, 0, 1)]);
    everything(disc);
    expect(signedArea(disc)).toBeCloseTo(Math.PI * 25, 9);
  });

  it('single vertex and empty polylines', () => {
    everything(contour([v(1, 2)]));
    everything(contour([]));
    expect(() => bbox(contour([]))).toThrow(RangeError);
    expect(signedArea(contour([]))).toBe(0);
    expect(length(contour([]))).toBe(0);
    expect(reverse(contour([])).vertices).toEqual([]);
  });

  it('tiny and huge bulges stay finite', () => {
    for (const b of [1e-12, 1e-9, 1.0001e-9, 1e-6, 1e6, -1e6, 1e12]) {
      everything(contour([v(0, 0, b), v(100, 0), v(100, 100), v(0, 100)]));
    }
  });
});

describe('T006 tester: sheet-sized numbers', () => {
  // CCW rounded rectangle 2440 x 1220, corner radius 3; each corner arc has bulge tan(22.5 deg)
  const q = Math.SQRT2 - 1;
  const W = 2440;
  const H = 1220;
  const R = 3;
  const rounded = (ox = 0, oy = 0): Polyline =>
    contour([
      v(ox + R, oy),
      v(ox + W - R, oy, q),
      v(ox + W, oy + R),
      v(ox + W, oy + H - R, q),
      v(ox + W - R, oy + H),
      v(ox + R, oy + H, q),
      v(ox, oy + H - R),
      v(ox, oy + R, q),
    ]);
  // area = W*H - (4 - pi) r^2; perimeter = 2(W + H) - 8r + 2 pi r
  const area = W * H - (4 - Math.PI) * R * R;
  const perimeter = 2 * (W + H) - 8 * R + 2 * Math.PI * R;

  it('area, perimeter and bbox match the closed-form values within EPS', () => {
    const p = rounded();
    expect(Math.abs(signedArea(p) - area)).toBeLessThan(EPS);
    expect(Math.abs(length(p) - perimeter)).toBeLessThan(EPS);
    const b = bbox(p);
    expect(Math.abs(b.minX)).toBeLessThan(EPS);
    expect(Math.abs(b.minY)).toBeLessThan(EPS);
    expect(Math.abs(b.maxX - W)).toBeLessThan(EPS);
    expect(Math.abs(b.maxY - H)).toBeLessThan(EPS);
    expect(orientation(p)).toBe('ccw');
  });

  it('still within EPS far from the origin and after a 90 deg rotation', () => {
    expect(Math.abs(signedArea(rounded(5000, -3000)) - area)).toBeLessThan(EPS);
    expect(Math.abs(signedArea(rotate(rounded(), 90)) - area)).toBeLessThan(EPS);
  });
});

describe('T006 tester: validate uses the arc-aware bbox', () => {
  // vertices span 400 x 100; the top edge (400,100)->(0,100) with bulge 1 is a semicircle of
  // radius 200 bulging up, so the real height is 100 + 200 = 300
  function archProject(sheetW: number, sheetH: number, grainLock = true): Project {
    const json: any = JSON.parse(JSON.stringify(mixed));
    json.layout.sheets = [];
    json.stock.sheet = { width: sheetW, height: sheetH, grain: 0 };
    const base = json.parts.find((p: any) => p.id === 'arch-panel');
    base.grainLock = grainLock;
    base.inners = [];
    base.holes = [];
    base.outline = [v(0, 0), v(400, 0), v(400, 100, 1), v(0, 100)];
    json.parts = [base];
    const r = parseProject(json);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.project;
  }

  it('vertices fit a 1000 x 250 sheet, the arc does not: flagged', () => {
    const issues = partLargerThanSheet(archProject(1000, 250));
    expect(issues.map((i) => i.code)).toEqual(['PART_LARGER_THAN_SHEET']);
    expect(issues[0]?.path).toBe('parts[0].outline');
    expect(issues[0]?.message).toContain('400 × 300 mm');
  });

  it('also flagged when free to turn 90 deg (300 x 400 does not fit 1000 x 250 either)', () => {
    expect(partLargerThanSheet(archProject(1000, 250, false))).toHaveLength(1);
  });

  it('exact fit (sheet height 300) and a roomier sheet: no issue', () => {
    expect(partLargerThanSheet(archProject(1000, 300))).toEqual([]);
    expect(partLargerThanSheet(archProject(1000, 400))).toEqual([]);
  });
});
