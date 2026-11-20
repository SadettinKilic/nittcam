import type { Vertex } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { labelSpot } from './label-spot';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const box = (vs: Vertex[]) => ({
  minX: Math.min(...vs.map((p) => p.x)),
  minY: Math.min(...vs.map((p) => p.y)),
  maxX: Math.max(...vs.map((p) => p.x)),
  maxY: Math.max(...vs.map((p) => p.y)),
});

describe('labelSpot (B50)', () => {
  it('a plain rectangle keeps its box centre and size', () => {
    const r = [v(0, 0), v(600, 0), v(600, 400), v(0, 400)];
    expect(labelSpot({ outline: r, inners: [], box: box(r) })).toEqual({
      x: 300,
      y: 200,
      w: 600,
      h: 400,
    });
  });

  it('an L part labels its longer leg, inside the material', () => {
    // bottom leg 600 × 100, left leg 100 × 400: the box centre (300, 200) is outside the L
    const l = [v(0, 0), v(600, 0), v(600, 100), v(100, 100), v(100, 400), v(0, 400)];
    const s = labelSpot({ outline: l, inners: [], box: box(l) });
    expect(s.y).toBeGreaterThan(0);
    expect(s.y).toBeLessThan(100);
    expect(s.x).toBeGreaterThan(200);
    expect(s.w).toBeGreaterThan(300);
    expect(s.h).toBeLessThanOrEqual(100);
  });

  it('a door with a window labels the rail, not the opening', () => {
    const door = [v(0, 0), v(596, 0), v(596, 716), v(0, 716)];
    const win = [v(98, 108), v(98, 608), v(498, 608), v(498, 108)];
    const s = labelSpot({ outline: door, inners: [win], box: box(door) });
    const inWindow = s.x > 98 && s.x < 498 && s.y > 108 && s.y < 608;
    expect(inWindow).toBe(false);
    expect(s.w).toBeGreaterThan(400);
  });
});
