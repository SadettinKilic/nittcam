import { describe, expect, it } from 'vitest';
import { EPS, JOIN_TOL } from './constants';
import {
  bbox,
  close,
  contour,
  isClosed,
  length,
  normalize,
  orientation,
  reverse,
  signedArea,
} from './polyline';
import { mirror, rotate, transform, translate } from './transform';
import type { Polyline } from './types';

const square: Polyline = contour([
  { x: 0, y: 0, bulge: 0 },
  { x: 10, y: 0, bulge: 0 },
  { x: 10, y: 10, bulge: 0 },
  { x: 0, y: 10, bulge: 0 },
]);

/** Circle of radius r centred at (cx, cy): two CCW semicircles. */
const circle = (r: number, cx = 0, cy = 0): Polyline =>
  contour([
    { x: cx - r, y: cy, bulge: 1 },
    { x: cx + r, y: cy, bulge: 1 },
  ]);

describe('signedArea / orientation', () => {
  it('square: +100 CCW, −100 reversed', () => {
    expect(signedArea(square)).toBe(100);
    expect(orientation(square)).toBe('ccw');
    expect(signedArea(reverse(square))).toBe(-100);
    expect(orientation(reverse(square))).toBe('cw');
  });

  it('circle of two semicircles: πr², length 2πr, bbox ±r', () => {
    const c = circle(25, 100, 50);
    expect(Math.abs(signedArea(c) - Math.PI * 625)).toBeLessThan(EPS);
    expect(Math.abs(length(c) - 50 * Math.PI)).toBeLessThan(EPS);
    const box = bbox(c);
    expect(box.minX).toBeCloseTo(75, 9);
    expect(box.maxX).toBeCloseTo(125, 9);
    expect(box.minY).toBeCloseTo(25, 9);
    expect(box.maxY).toBeCloseTo(75, 9);
  });

  it('degenerate (collinear) contour has orientation none and normalize leaves it alone', () => {
    const flat = contour([
      { x: 0, y: 0, bulge: 0 },
      { x: 5, y: 0, bulge: 0 },
      { x: 10, y: 0, bulge: 0 },
    ]);
    expect(orientation(flat)).toBe('none');
    expect(normalize(flat, 'inner')).toEqual(flat);
  });

  it('open polyline: area closes with a straight chord; normalize keeps open paths', () => {
    const open: Polyline = { vertices: square.vertices, closed: false };
    expect(signedArea(open)).toBe(100);
    expect(length(open)).toBe(30);
    expect(normalize(reverse(open), 'outer')).toEqual(reverse(open));
  });
});

describe('reverse / normalize', () => {
  it('reverse keeps the start vertex and moves negated bulges to the right segments', () => {
    const p = contour([
      { x: 0, y: 0, bulge: 0.1 },
      { x: 10, y: 0, bulge: 0.2 },
      { x: 10, y: 10, bulge: 0 },
    ]);
    expect(reverse(p).vertices).toEqual([
      { x: 0, y: 0, bulge: 0 }, // old segment 2 (v2 → v0) reversed
      { x: 10, y: 10, bulge: -0.2 }, // old segment 1 (v1 → v2) reversed
      { x: 10, y: 0, bulge: -0.1 }, // old segment 0 (v0 → v1) reversed
    ]);
  });

  it('reverse of an open polyline', () => {
    const p: Polyline = {
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0.3 },
        { x: 5, y: 0, bulge: 0.5 },
        { x: 5, y: 5, bulge: 0 },
      ],
    };
    const r = reverse(p);
    expect(r.vertices.map((v) => [v.x, v.y, v.bulge])).toEqual([
      [5, 5, -0.5],
      [5, 0, -0.3],
      [0, 0, 0],
    ]);
    expect(reverse(r)).toEqual(p);
    expect(length(r)).toBeCloseTo(length(p), 12);
  });

  it('normalize: outer → CCW, inner → CW', () => {
    expect(orientation(normalize(square, 'outer'))).toBe('ccw');
    expect(orientation(normalize(square, 'inner'))).toBe('cw');
    expect(normalize(square, 'outer')).toEqual(square);
    expect(normalize(square, 'outer')).not.toBe(square);
  });
});

describe('bbox', () => {
  it('a bulging-out edge extends the box beyond the vertices', () => {
    // bottom edge bulges down by sagitta 0.5·10/2 = 2.5
    const p = contour([
      { x: 0, y: 0, bulge: 0.5 },
      { x: 10, y: 0, bulge: 0 },
      { x: 10, y: 10, bulge: 0 },
      { x: 0, y: 10, bulge: 0 },
    ]);
    expect(bbox(p).minY).toBeCloseTo(-2.5, 9);
    expect(bbox(p).maxY).toBe(10);
  });

  it('an arc over 180° reaches the axis extremes beyond the endpoints', () => {
    // 270° CCW arc from (10, 0) to (0, −10) about the origin, closed by a line
    const p = contour([
      { x: 10, y: 0, bulge: Math.tan((3 * Math.PI) / 8) },
      { x: 0, y: -10, bulge: 0 },
    ]);
    const box = bbox(p);
    expect(box.minX).toBeCloseTo(-10, 9);
    expect(box.maxY).toBeCloseTo(10, 9);
    expect(box.maxX).toBeCloseTo(10, 9);
    expect(box.minY).toBeCloseTo(-10, 9);
  });

  it('throws on an empty polyline', () => {
    expect(() => bbox({ vertices: [], closed: true })).toThrow(RangeError);
  });
});

describe('transform', () => {
  it('quarter turns are exact (no float drift)', () => {
    const p = contour([
      { x: 0.1, y: 0.2, bulge: 0.3 },
      { x: 1234.567, y: 0.2, bulge: 0 },
      { x: 1234.567, y: 89.01, bulge: 0 },
    ]);
    expect(rotate(p, 90).vertices[1]).toEqual({ x: -0.2, y: 1234.567, bulge: 0 });
    expect(rotate(p, 180).vertices[1]).toEqual({ x: -1234.567, y: -0.2, bulge: 0 });
    expect(rotate(p, 270).vertices[1]).toEqual({ x: 0.2, y: -1234.567, bulge: 0 });
    expect(rotate(rotate(rotate(rotate(p, 90), 90), 90), 90)).toEqual(p);
    expect(rotate(p, 0)).toEqual(p);
  });

  it('rotating (0, 0) gives +0, never −0', () => {
    const v = rotate(square, 180).vertices[0];
    expect(Object.is(v?.x, 0)).toBe(true);
    expect(Object.is(v?.y, 0)).toBe(true);
  });

  it('mirror negates x or y and the bulges, and flips orientation', () => {
    const p = contour([
      { x: 0, y: 0, bulge: 0.2 },
      { x: 10, y: 0, bulge: 0 },
      { x: 10, y: 10, bulge: 0 },
    ]);
    expect(mirror(p, 'x').vertices[1]).toEqual({ x: -10, y: 0, bulge: 0 });
    expect(mirror(p, 'x').vertices[0]?.bulge).toBe(-0.2);
    expect(mirror(p, 'y').vertices[2]).toEqual({ x: 10, y: -10, bulge: 0 });
    expect(orientation(mirror(p, 'y'))).toBe('cw');
  });

  it('transform applies mirror, then rotate, then translate', () => {
    const t = transform(square, { mirror: 'x', rotate: 90, dx: 5, dy: -5 });
    const expected = translate(rotate(mirror(square, 'x'), 90), 5, -5);
    expect(t).toEqual(expected);
    expect(transform(square, {})).toEqual(square);
  });
});

describe('isClosed / close', () => {
  const open = (gap: number): Polyline => ({
    closed: false,
    vertices: [...square.vertices, { x: gap, y: 0, bulge: 0 }],
  });

  it('ends within JOIN_TOL join; the duplicate end vertex is dropped', () => {
    expect(isClosed(open(JOIN_TOL / 2))).toBe(true);
    expect(close(open(JOIN_TOL / 2))).toEqual(square);
    expect(isClosed(open(0))).toBe(true);
  });

  it('ends farther apart than JOIN_TOL stay open', () => {
    expect(isClosed(open(JOIN_TOL * 2))).toBe(false);
    expect(close(open(JOIN_TOL * 2))).toEqual(open(JOIN_TOL * 2));
  });

  it('a closed polyline is closed', () => {
    expect(isClosed(square)).toBe(true);
    expect(close(square)).toEqual(square);
  });
});
