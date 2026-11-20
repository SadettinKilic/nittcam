import type { BoardPart, Vertex } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { chipWidthPx, dimOwner, dimText, segmentLabels } from './dims';

const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const SQUARE = [v(0, 0), v(600, 0), v(600, 400), v(0, 400)];

function part(id: string, minX: number, minY: number, maxX: number, maxY: number): BoardPart {
  return {
    id,
    at: { x: minX, y: minY },
    placed: true,
    outline: [],
    inners: [],
    holes: [],
    dims: [],
    box: { minX, minY, maxX, maxY },
  };
}

describe('segmentLabels (T133)', () => {
  it('one label per segment, outside the CCW outline, Turkish digits', () => {
    const labels = segmentLabels(SQUARE, [], 1);
    expect(labels.map((l) => l.text)).toEqual(['600', '400', '600', '400']);
    // bottom edge: label below it (outside), 18 px = 18 mm at scale 1
    expect(labels[0]?.at).toEqual({ x: 300, y: -18 });
    // right edge: the chip clears the edge by its half width + 5 px air (B50)
    expect(labels[1]?.at).toEqual({ x: 600 + chipWidthPx('400') / 2 + 5, y: 200 });
  });

  it('keeps a constant screen size: the offset shrinks in mm as the zoom grows', () => {
    const near = segmentLabels(SQUARE, [], 4);
    expect(near[0]?.at.y).toBeCloseTo(-4.5, 9);
  });

  it('leaves out labels that do not fit at this zoom, but never the active segment', () => {
    const tiny = segmentLabels(SQUARE, [], 0.01, 2);
    expect(tiny).toHaveLength(1);
    expect(tiny[0]).toMatchObject({ text: '600', active: true });
    expect(600 * 0.01).toBeLessThan(chipWidthPx('600'));
  });

  it('labels inner contours too (inside the opening for a CW contour)', () => {
    const hole = [v(100, 100), v(100, 300), v(300, 300), v(300, 100)];
    const labels = segmentLabels(SQUARE, [hole], 1);
    expect(labels).toHaveLength(8);
    // first inner segment runs up the left side: right of travel = +x, into the opening
    expect(labels[4]?.at).toEqual({ x: 100 + chipWidthPx('200') / 2 + 5, y: 200 });
  });

  it('leaves out a chip that would overlap another one; longer and active segments win (B50)', () => {
    // a 200 × 150 console with a 40 mm step at 39 % (CTO #6): short chips crowd the corner
    const step = [v(0, 0), v(200, 0), v(200, 150), v(110, 150), v(110, 110), v(0, 110)];
    const labels = segmentLabels(step, [], 0.39);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i] as (typeof labels)[number];
        const b = labels[j] as (typeof labels)[number];
        const apart =
          Math.abs(a.at.x - b.at.x) * 0.39 >= (chipWidthPx(a.text) + chipWidthPx(b.text)) / 2 ||
          Math.abs(a.at.y - b.at.y) * 0.39 >= 18;
        expect(apart).toBe(true);
      }
    }
    expect(labels.map((l) => l.text)).toContain('200');
    const active = segmentLabels(step, [], 0.39, 3);
    expect(active.find((l) => l.active)?.text).toBe('40');
  });

  it('arc length for a bent segment', () => {
    const half = [v(0, 0, 1), v(200, 0)];
    expect(segmentLabels(half, [], 1)[0]?.text).toBe('314,2');
  });
});

describe('dimOwner / dimText (T133)', () => {
  const parts = [part('big', 0, 0, 1000, 1000), part('small', 100, 100, 300, 300)];
  it('the smallest part box holding both points, the selected one first', () => {
    expect(dimOwner(parts, { x: 120, y: 120 }, { x: 280, y: 120 }, null)).toBe('small');
    expect(dimOwner(parts, { x: 120, y: 120 }, { x: 280, y: 120 }, 'big')).toBe('big');
    expect(dimOwner(parts, { x: 120, y: 120 }, { x: 900, y: 120 }, 'small')).toBe('big');
    expect(dimOwner(parts, { x: -50, y: 0 }, { x: 10, y: 0 }, null)).toBeNull();
  });
  it('aligned length text', () => {
    expect(dimText({ x: 0, y: 0 }, { x: 300, y: 400 })).toBe('500');
  });
});
