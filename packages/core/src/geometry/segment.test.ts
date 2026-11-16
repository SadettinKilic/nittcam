import { describe, expect, it } from 'vitest';
import { EPS, MIN_BULGE } from './constants';
import {
  arcOf,
  bulgeToSweep,
  isArc,
  sampleSegment,
  segmentArea,
  segmentBBox,
  segmentLength,
  segmentMidpoint,
  sweepToBulge,
} from './segment';

const Q = Math.tan(Math.PI / 8); // quarter arc

describe('segment helpers', () => {
  it('bulge ↔ sweep', () => {
    expect(bulgeToSweep(1)).toBeCloseTo(Math.PI, 12);
    expect(bulgeToSweep(-1)).toBeCloseTo(-Math.PI, 12);
    expect(sweepToBulge(Math.PI / 2)).toBeCloseTo(Q, 15);
    expect(bulgeToSweep(sweepToBulge(1.234))).toBeCloseTo(1.234, 12);
  });

  it('lines: zero bulge, tiny bulge and zero-length chords are not arcs', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(isArc(a, b, 0)).toBe(false);
    expect(isArc(a, b, MIN_BULGE / 2)).toBe(false);
    expect(isArc(a, a, 1)).toBe(false);
    expect(isArc(a, b, MIN_BULGE)).toBe(true);
    expect(arcOf(a, b, 0)).toBeUndefined();
    expect(segmentLength(a, b, 0)).toBe(10);
    expect(segmentMidpoint(a, b, 0)).toEqual({ x: 5, y: 0 });
  });

  it('CCW semicircle (bulge 1): centre at the chord midpoint, bulges to the right', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const arc = arcOf(a, b, 1);
    expect(arc?.center.x).toBeCloseTo(5, 12);
    expect(arc?.center.y).toBeCloseTo(0, 12);
    expect(arc?.radius).toBeCloseTo(5, 12);
    expect(arc?.startAngle).toBeCloseTo(Math.PI, 12);
    expect(arc?.sweep).toBeCloseTo(Math.PI, 12);
    // going CCW from angle π the arc passes through angle 3π/2: below the chord
    const m = segmentMidpoint(a, b, 1);
    expect(m.x).toBeCloseTo(5, 12);
    expect(m.y).toBeCloseTo(-5, 12);
    expect(segmentLength(a, b, 1)).toBeCloseTo(5 * Math.PI, 12);
    const box = segmentBBox(a, b, 1);
    expect(box.minY).toBeCloseTo(-5, 12);
    expect(box.maxY).toBeCloseTo(0, 12);
  });

  it('CW quarter arc (bulge −tan 22.5°): centre on the right, sweep −90°', () => {
    // from (0, 10) to (10, 0) clockwise about the origin
    const arc = arcOf({ x: 0, y: 10 }, { x: 10, y: 0 }, -Q);
    expect(arc?.center.x).toBeCloseTo(0, 12);
    expect(arc?.center.y).toBeCloseTo(0, 12);
    expect(arc?.radius).toBeCloseTo(10, 12);
    expect(arc?.sweep).toBeCloseTo(-Math.PI / 2, 12);
    const m = segmentMidpoint({ x: 0, y: 10 }, { x: 10, y: 0 }, -Q);
    expect(m.x).toBeCloseTo(10 / Math.SQRT2, 12);
    expect(m.y).toBeCloseTo(10 / Math.SQRT2, 12);
    // quarter arc between two axis points: bbox is the endpoints' box
    const box = segmentBBox({ x: 0, y: 10 }, { x: 10, y: 0 }, -Q);
    expect(box.maxX).toBeCloseTo(10, 12);
    expect(box.maxY).toBeCloseTo(10, 12);
  });

  it('sampled points lie on the circle and end at both endpoints', () => {
    const a = { x: 3, y: 4 };
    const b = { x: -7, y: 2 };
    const arc = arcOf(a, b, 0.7);
    if (!arc) throw new Error('arc expected');
    const pts = sampleSegment(a, b, 0.7, 16);
    expect(pts).toHaveLength(17);
    for (const p of pts) {
      expect(
        Math.abs(Math.hypot(p.x - arc.center.x, p.y - arc.center.y) - arc.radius),
      ).toBeLessThan(EPS);
    }
    expect(pts[0]?.x).toBeCloseTo(a.x, 9);
    expect(pts[16]?.x).toBeCloseTo(b.x, 9);
    expect(pts[16]?.y).toBeCloseTo(b.y, 9);
  });

  it('segment area: tiny bulges match the series (no cancellation)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1000, y: 0 };
    // circular segment area ≈ (2/3)·chord·sagitta, sagitta = b·chord/2
    const bulge = 1e-6;
    const expected = (2 / 3) * 1000 * ((bulge * 1000) / 2);
    expect(segmentArea(a, b, bulge)).toBeCloseTo(expected, 9);
  });
});
