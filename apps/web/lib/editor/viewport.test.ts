import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  fitBox,
  gridLevels,
  rulerStep,
  rulerTicks,
  toScreen,
  toWorld,
  visibleBox,
  zoomAt,
  type Viewport,
} from './viewport';

const view = fc.record({
  scale: fc.double({ min: 0.02, max: 40, noNaN: true }),
  x: fc.double({ min: -5000, max: 5000, noNaN: true }),
  y: fc.double({ min: -5000, max: 5000, noNaN: true }),
});
const pt = fc.record({
  x: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
  y: fc.double({ min: -1e4, max: 1e4, noNaN: true }),
});

describe('editor viewport (T124)', () => {
  it('Y is up on the board, down on the screen', () => {
    const v: Viewport = { scale: 2, x: 100, y: 500 };
    expect(toScreen(v, { x: 0, y: 0 })).toEqual({ x: 100, y: 500 });
    expect(toScreen(v, { x: 10, y: 10 })).toEqual({ x: 120, y: 480 });
  });

  it('toWorld inverts toScreen', () => {
    fc.assert(
      fc.property(view, pt, (v, p) => {
        const back = toWorld(v, toScreen(v, p));
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }),
    );
  });

  it('zoom keeps the board point under the cursor', () => {
    fc.assert(
      fc.property(view, pt, fc.double({ min: 0.5, max: 2, noNaN: true }), (v, s, f) => {
        const before = toWorld(v, s);
        const after = toWorld(zoomAt(v, f, s), s);
        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
      }),
    );
  });

  it('fit shows the whole box inside the free area', () => {
    const box = { minX: 0, minY: -2000, maxX: 2800, maxY: 0 };
    const v = fitBox(box, 800, 600, { top: 40, right: 0, bottom: 30, left: 50 });
    const vis = visibleBox(v, 800, 600);
    expect(vis.minX).toBeLessThanOrEqual(0);
    expect(vis.maxX).toBeGreaterThanOrEqual(2800);
    expect(vis.minY).toBeLessThanOrEqual(-2000);
    expect(vis.maxY).toBeGreaterThanOrEqual(0);
    const tl = toScreen(v, { x: 0, y: 0 });
    expect(tl.x).toBeGreaterThanOrEqual(50);
    expect(tl.y).toBeGreaterThanOrEqual(40);
  });

  it('fit with 48 px padding frames the box edge to edge (T243)', () => {
    const box = { minX: 0, minY: 0, maxX: 2000, maxY: 500 };
    const insets = { top: 22, right: 0, bottom: 0, left: 46 };
    const v = fitBox(box, 800, 600, insets, 48);
    const a = toScreen(v, { x: 0, y: 500 });
    const b = toScreen(v, { x: 2000, y: 0 });
    // The binding axis (width) touches the padding exactly; the other one is centred inside it.
    expect(a.x).toBeCloseTo(46 + 48, 6);
    expect(b.x).toBeCloseTo(800 - 48, 6);
    expect(a.y).toBeGreaterThanOrEqual(22 + 48 - 1e-6);
    expect(b.y).toBeLessThanOrEqual(600 - 48 + 1e-6);
    // Fills more than the unpadded 90 % fit for a large canvas.
    expect(v.scale).toBeGreaterThan(fitBox(box, 800, 600, insets).scale * 0.9);
  });

  it('grid adapts 1 / 10 / 100 mm with zoom', () => {
    expect(gridLevels(10)).toEqual({ fine: 1, major: 10 });
    expect(gridLevels(0.5)).toEqual({ fine: 100, major: 1000 });
    expect(gridLevels(2)).toEqual({ fine: 10, major: 100 });
    expect(gridLevels(0.001).fine).toBe(1000);
  });

  it('ruler steps are 1-2-5 and at least 64 px apart', () => {
    for (const s of [0.013, 0.1, 0.37, 1, 4.2, 30]) {
      const step = rulerStep(s);
      expect(step * s).toBeGreaterThanOrEqual(64 - 1e-9);
      const m = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
      expect([1, 2, 5]).toContain(Math.round(m));
    }
    expect(rulerTicks(-15, 31, 10)).toEqual([-10, 0, 10, 20, 30]);
  });
});
