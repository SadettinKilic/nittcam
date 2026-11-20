/** T284 (D-058): which arcs count as corners for outer-contour tabs. */
import { describe, expect, it } from 'vitest';
import type { PathSeg } from './path';
import { cornerArcMask } from './tabs';

const Q = Math.tan(Math.PI / 8); // bulge of a 90° arc
const H = 1; // bulge of a 180° arc
const P = (x: number, y: number) => ({ x, y });
const seg = (a: [number, number], b: [number, number], bulge = 0): PathSeg => ({
  p0: P(...a),
  p1: P(...b),
  bulge,
});

/** Rounded rectangle 0..w × 0..h, radius r, CCW, starting mid bottom. */
function roundedRect(w: number, h: number, r: number): PathSeg[] {
  return [
    seg([w / 2, 0], [w - r, 0]),
    seg([w - r, 0], [w, r], Q),
    seg([w, r], [w, h - r]),
    seg([w, h - r], [w - r, h], Q),
    seg([w - r, h], [r, h]),
    seg([r, h], [0, h - r], Q),
    seg([0, h - r], [0, r]),
    seg([0, r], [r, 0], Q),
    seg([r, 0], [w / 2, 0]),
  ];
}

describe('cornerArcMask (T284)', () => {
  it('the four 90° arcs of a rounded rectangle are corners, the sides are not', () => {
    expect(cornerArcMask(roundedRect(20, 20, 7.5))).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it('a corner arc split by the start point is still one corner run', () => {
    const r = 5;
    const m = Math.SQRT1_2 * r;
    const segs: PathSeg[] = [
      seg([20 - r + m, r - m], [20, r], Math.tan(Math.PI / 16)),
      seg([20, r], [20, 20]),
      seg([20, 20], [0, 20]),
      seg([0, 20], [0, 0]),
      seg([0, 0], [20 - r, 0]),
      seg([20 - r, 0], [20 - r + m, r - m], Math.tan(Math.PI / 16)),
    ];
    expect(cornerArcMask(segs)).toEqual([true, false, false, false, false, true]);
  });

  it('a disc (two or four arcs of one circle) has no corner', () => {
    expect(cornerArcMask([seg([30, 0], [-30, 0], H), seg([-30, 0], [30, 0], H)])).toEqual([
      false,
      false,
    ]);
    expect(
      cornerArcMask([
        seg([30, 0], [0, 30], Q),
        seg([0, 30], [-30, 0], Q),
        seg([-30, 0], [0, -30], Q),
        seg([0, -30], [30, 0], Q),
      ]),
    ).toEqual([false, false, false, false]);
  });

  it('a stadium end (two co-circular 90° arcs = 180°) is not a corner', () => {
    const segs: PathSeg[] = [
      seg([0, 0], [40, 0]),
      seg([40, 0], [50, 10], Q),
      seg([50, 10], [40, 20], Q),
      seg([40, 20], [0, 20]),
      seg([0, 20], [0, 0], H),
    ];
    expect(cornerArcMask(segs)).toEqual([false, false, false, false, false]);
  });

  it('arcs between other arcs only (letter "O" outline) are not corners', () => {
    // an ellipse-like loop of four 90° arcs on different circles
    const segs: PathSeg[] = [
      seg([20, 0], [0, 10], Q),
      seg([0, 10], [-20, 0], Q),
      seg([-20, 0], [0, -10], Q),
      seg([0, -10], [20, 0], Q),
    ];
    expect(cornerArcMask(segs).some(Boolean)).toBe(false);
  });
});
