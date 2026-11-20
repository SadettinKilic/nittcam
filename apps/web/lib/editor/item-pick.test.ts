import { describe, expect, it } from 'vitest';
import type { BoardPart, Vertex } from '@nittcam/core';
import { pickItem, withItemMoved } from './item-pick';

const v = (x: number, y: number): Vertex => ({ x, y, bulge: 0 });
const PART: BoardPart = {
  id: 'a',
  at: { x: 0, y: 0 },
  placed: true,
  outline: [v(0, 0), v(400, 0), v(400, 300), v(0, 300)],
  // CW cut-out 200..300 × 100..200
  inners: [[v(200, 100), v(200, 200), v(300, 200), v(300, 100)]],
  holes: [{ id: 'h1', x: 50, y: 50, d: 20, type: 'through' }],
  dims: [],
  box: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
};

describe('pickItem (B52)', () => {
  it('finds a hole on its disc or near its rim, a cut-out inside or near its edge', () => {
    expect(pickItem(PART, { x: 52, y: 50 }, 1)).toEqual({ kind: 'hole', index: 0 });
    expect(pickItem(PART, { x: 61, y: 50 }, 2)).toEqual({ kind: 'hole', index: 0 });
    expect(pickItem(PART, { x: 250, y: 150 }, 1)).toEqual({ kind: 'inner', index: 0 });
    expect(pickItem(PART, { x: 302, y: 150 }, 3)).toEqual({ kind: 'inner', index: 0 });
    expect(pickItem(PART, { x: 120, y: 250 }, 3)).toBeNull();
  });
});

describe('withItemMoved (B52)', () => {
  it('shifts only the dragged item', () => {
    const [h] = withItemMoved([PART], 'a', { kind: 'hole', index: 0 }, { x: 10, y: -5 });
    expect(h?.holes[0]).toMatchObject({ x: 60, y: 45 });
    expect(h?.inners).toBe(PART.inners);
    const [c] = withItemMoved([PART], 'a', { kind: 'inner', index: 0 }, { x: 10, y: 0 });
    expect(c?.inners[0]?.[0]).toEqual({ x: 210, y: 100, bulge: 0 });
    expect(c?.holes).toBe(PART.holes);
  });
});
