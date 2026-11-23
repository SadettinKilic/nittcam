import { describe, expect, it } from 'vitest';
import { clearance, labelSpot, spotLabel } from './label-spot';

const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

describe('labelSpot (B44)', () => {
  it('a plain rectangle keeps the centred label over the whole footprint', () => {
    expect(labelSpot({ w: 600, h: 400, outline: null, inners: [], holes: [] })).toEqual({
      cx: 300,
      cy: 200,
      w: 600,
      h: 400,
    });
  });

  it('a door with hinge cups at its edge keeps the centre', () => {
    const spot = labelSpot({
      w: 596,
      h: 716,
      outline: null,
      inners: [],
      holes: [
        { x: 22.5, y: 100, r: 17.5 },
        { x: 22.5, y: 616, r: 17.5 },
      ],
    });
    expect(spot).toEqual({ cx: 298, cy: 358, w: 596, h: 716 });
  });

  it('a frame with a big opening puts the label on the frame, never in the opening', () => {
    const shape = { w: 400, h: 400, outline: null, inners: [rect(60, 60, 340, 340)], holes: [] };
    const spot = labelSpot(shape);
    expect(clearance(shape, spot.cx, spot.cy)).toBeGreaterThan(0);
    // The box fits in the 60 mm band.
    expect(spot.h).toBeLessThanOrEqual(30);
  });

  it('an L shape puts the label in its arm, not in the empty corner', () => {
    // L: full bottom band (y 300..400) and left column (x 0..100), footprint 400 × 400.
    const outline = [0, 0, 100, 0, 100, 300, 400, 300, 400, 400, 0, 400];
    const shape = { w: 400, h: 400, outline, inners: [], holes: [] };
    const spot = labelSpot(shape);
    expect(clearance(shape, spot.cx, spot.cy)).toBeGreaterThan(30);
    expect(spot.cx < 100 || spot.cy > 300).toBe(true);
  });
});

describe('spotLabel (T319)', () => {
  it('a 600 × 400 panel with a cut-out, circle and holes prints its own size, not the spot room', () => {
    const shape = {
      w: 600,
      h: 400,
      outline: null,
      inners: [rect(330, 80, 470, 320)],
      holes: [
        { x: 150, y: 200, r: 30 },
        { x: 60, y: 60, r: 4 },
        { x: 60, y: 340, r: 4 },
      ],
    };
    const spot = labelSpot(shape);
    expect(spot.w).toBeLessThan(600);
    const label = spotLabel({ label: '4.1', name: 'Elif panel', w: 600, h: 400 }, spot, 2);
    expect(label.level).toBe('full');
    expect(label.lines[1]).toBe('600 × 400');
  });
});
