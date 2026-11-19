import type { BoardPart } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { boardSummary } from './summary';

function rect(id: string, x: number, y: number, w: number, h: number): BoardPart {
  return {
    id,
    at: { x, y },
    placed: true,
    outline: [
      { x, y, bulge: 0 },
      { x: x + w, y, bulge: 0 },
      { x: x + w, y: y + h, bulge: 0 },
      { x, y: y + h, bulge: 0 },
    ],
    inners: [],
    holes: [],
    dims: [],
    box: { minX: x, minY: y, maxX: x + w, maxY: y + h },
  };
}

describe('boardSummary (T242)', () => {
  it('is empty without parts', () => {
    expect(boardSummary([], new Map())).toEqual({ parts: 0, pieces: 0, areaM2: 0, extents: null });
  });

  it('counts pieces by quantity and sums the area in m²', () => {
    const parts = [rect('a', 0, 0, 1000, 500), rect('b', 1200, 0, 500, 500)];
    const s = boardSummary(parts, new Map([['a', 2]]));
    expect(s.parts).toBe(2);
    expect(s.pieces).toBe(3);
    expect(s.areaM2).toBeCloseTo(2 * 0.5 + 0.25, 9);
    expect(s.extents).toEqual({ w: 1700, h: 500 });
  });

  it('subtracts inner contours and measures arcs exactly', () => {
    const outer = rect('c', 0, 0, 1000, 1000);
    const hole = rect('h', 250, 250, 500, 500).outline.slice().reverse();
    const s = boardSummary([{ ...outer, inners: [hole] }], new Map());
    expect(s.areaM2).toBeCloseTo(1 - 0.25, 9);
    // A full circle of radius 100 as two half-circle arcs (bulge 1).
    const circle: BoardPart = {
      ...rect('o', 0, 0, 200, 200),
      outline: [
        { x: 0, y: 100, bulge: 1 },
        { x: 200, y: 100, bulge: 1 },
      ],
    };
    expect(boardSummary([circle], new Map()).areaM2).toBeCloseTo((Math.PI * 100 * 100) / 1e6, 9);
  });
});
