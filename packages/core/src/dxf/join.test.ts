import { describe, expect, it } from 'vitest';
import type { Polyline } from '../geometry/types';
import { joinPaths } from './join';
import type { DxfPath } from './types';

const poly = (pts: [number, number][], closed: boolean): Polyline => ({
  closed,
  vertices: pts.map(([x, y]) => ({ x, y, bulge: 0 })),
});
const rect = (layer: string, x0: number, y0: number, x1: number, y1: number): DxfPath => ({
  layer,
  type: 'LWPOLYLINE',
  poly: poly(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    true,
  ),
});
const line = (layer: string, x0: number, y0: number, x1: number, y1: number): DxfPath => ({
  layer,
  type: 'LINE',
  poly: poly(
    [
      [x0, y0],
      [x1, y1],
    ],
    false,
  ),
});

describe('joinPaths: a LINE over a closed polyline edge (B53, tester B16)', () => {
  it('a line on part of an edge is a duplicate, not an open chain', () => {
    const r = joinPaths([rect('A', 0, 0, 200, 100), line('A', 50, 0, 150, 0)]);
    expect(r.contours).toHaveLength(1);
    expect(r.open).toHaveLength(0);
    expect(r.duplicates).toBe(1);
  });

  it('a part outlined twice (polyline + four lines) imports once', () => {
    const r = joinPaths([
      rect('A', 0, 0, 200, 100),
      line('A', 0, 0, 200, 0),
      line('A', 200, 0, 200, 100),
      line('A', 200, 100, 0, 100),
      line('A', 0, 100, 0, 0),
    ]);
    expect(r.contours).toHaveLength(1);
    expect(r.open).toHaveLength(0);
    expect(r.duplicates).toBe(4);
  });

  it('a neighbour drawn from lines that shares an edge still closes', () => {
    const r = joinPaths([
      rect('A', 0, 0, 200, 100),
      line('A', 200, 0, 300, 0),
      line('A', 300, 0, 300, 100),
      line('A', 300, 100, 200, 100),
      line('A', 200, 100, 200, 0), // on the rectangle's right edge, but closes the neighbour
    ]);
    expect(r.contours).toHaveLength(2);
    expect(r.open).toHaveLength(0);
    expect(r.duplicates).toBe(0);
  });

  it('another layer, a line off the edge or a slanted line stay as they were', () => {
    const r = joinPaths([
      rect('A', 0, 0, 200, 100),
      line('B', 50, 0, 150, 0),
      line('A', 50, 1, 150, 1),
      line('A', 0, 0, 200, 100),
    ]);
    expect(r.duplicates).toBe(0);
    expect(r.open).toHaveLength(3);
  });
});
