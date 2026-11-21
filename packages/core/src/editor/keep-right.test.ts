/** B52 (D-096): "Dik açıyı koru" for a length edit on an orthogonal outline. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vertex } from '../geometry/types';
import { keepsRightAngle, withSegmentLength } from './edit';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const RECT = [v(0, 0), v(600, 0), v(600, 400), v(0, 400)];
// L: 600 wide, 400 high, notch 300 × 200 top right
const L = [v(0, 0), v(600, 0), v(600, 200), v(300, 200), v(300, 400), v(0, 400)];

const pts = (vs: readonly Vertex[]) => vs.map((q) => [q.x, q.y]);

describe('withSegmentLength keepRight (B52)', () => {
  it('a rectangle edge: the far edge slides, all corners stay right angles', () => {
    const r = withSegmentLength(RECT, 0, 500, true);
    expect(r.ok && pts(r.vertices)).toEqual([
      [0, 0],
      [500, 0],
      [500, 400],
      [0, 400],
    ]);
    // without the option the end corner moves alone (the right edge tilts)
    const off = withSegmentLength(RECT, 0, 500);
    expect(off.ok && pts(off.vertices)[2]).toEqual([600, 400]);
  });

  it('an L notch edge keeps its right angles', () => {
    const r = withSegmentLength(L, 1, 250, true);
    expect(r.ok && pts(r.vertices)).toEqual([
      [0, 0],
      [600, 0],
      [600, 250],
      [300, 250],
      [300, 400],
      [0, 400],
    ]);
  });

  it('falls back to moving the end corner where the corners are not right angles', () => {
    const tri = [v(0, 0), v(400, 0), v(200, 300), v(0, 300)];
    expect(keepsRightAngle(tri, 0)).toBe(false);
    const r = withSegmentLength(tri, 0, 300, true);
    expect(r.ok && pts(r.vertices)[1]).toEqual([300, 0]);
    expect(keepsRightAngle([v(0, 0), v(100, 0, 0.5), v(100, 100), v(0, 100)], 0)).toBe(false);
  });

  it('property: every accepted keepRight edit of a rectangle is still axis-aligned', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 2000 }), (i, len) => {
        const r = withSegmentLength(RECT, i, len, true);
        if (!r.ok) return true;
        return r.vertices.every((a, k) => {
          const b = r.vertices[(k + 1) % 4] as Vertex;
          return a.x === b.x || a.y === b.y;
        });
      }),
    );
  });
});
