import { describe, expect, it } from 'vitest';
import type { Part } from '@nittcam/core';
import { footprintHoles, footprintOutline, isQuarterTurn, ringLength } from './placed-outline';
import { sheetFigures, type DrawnPart } from '../components/layout-view/model';

const rect = {
  id: 'p1',
  kind: 'rect',
  name: 'A',
  qty: 1,
  grain: { mode: 'fixed', angle: 0 },
  params: { w: 100, h: 50, r: 0 },
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
} as unknown as Part;

describe('footprintOutline', () => {
  it('is null for a rectangle at a quarter turn', () => {
    expect(isQuarterTurn(0)).toBe(true);
    expect(isQuarterTurn(270)).toBe(true);
    expect(isQuarterTurn(30)).toBe(false);
    expect(footprintOutline(rect, 90, 100)).toBeNull();
  });

  it('draws a 30° rectangle as its turned corners inside the bbox', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const w = 100 * c + 50 * s;
    const h = 100 * s + 50 * c;
    const pts = footprintOutline(rect, 30, h);
    expect(pts).not.toBeNull();
    const xs = (pts ?? []).filter((_, i) => i % 2 === 0);
    const ys = (pts ?? []).filter((_, i) => i % 2 === 1);
    expect(xs).toHaveLength(4);
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(w, 3);
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
    expect(Math.max(...ys)).toBeCloseTo(h, 3);
  });
});

describe('footprintHoles and sheet figures (T171)', () => {
  const door = {
    ...rect,
    holes: [{ id: 'h1', type: 'blind', cx: 20, cy: 10, d: 35, depth: 12 }],
  } as unknown as Part;

  it('places a hole in the footprint frame (Y down) and turns it with the part', () => {
    expect(footprintHoles(door, 0, 50)).toEqual([{ x: 20, y: 40, r: 17.5 }]);
    // 180°: the hole moves to the opposite corner, so a mirrored door reads apart.
    expect(footprintHoles(door, 180, 50)).toEqual([{ x: 80, y: 10, r: 17.5 }]);
  });

  it('sums outer and inner contour lengths per sheet', () => {
    expect(ringLength([0, 0, 10, 0, 10, 10, 0, 10])).toBe(40);
    const part = { w: 100, h: 50, outline: null, inners: [[0, 0, 10, 0, 10, 10, 0, 10]] };
    expect(sheetFigures([part, { ...part, inners: [] }] as unknown as DrawnPart[])).toEqual({
      parts: 2,
      cutLength: 300 + 40 + 300,
    });
  });
});
