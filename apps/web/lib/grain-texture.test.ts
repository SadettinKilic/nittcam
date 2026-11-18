import { describe, expect, it } from 'vitest';
import { grainLines } from './grain-texture';

describe('grainLines', () => {
  it('draws horizontal lines at 0° across the whole width', () => {
    const lines = grainLines(1000, 500, 0, 100);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const [x1, y1, x2, y2] of lines) {
      expect(y1).toBeCloseTo(y2, 6);
      expect(Math.min(x1, x2)).toBeCloseTo(0, 6);
      expect(Math.max(x1, x2)).toBeCloseTo(1000, 6);
    }
  });

  it('keeps every line inside the sheet and along the angle', () => {
    for (const angle of [30, 45, 90, 135, 179.5]) {
      const lines = grainLines(2800, 2070, angle, 70);
      expect(lines.length).toBeGreaterThan(10);
      for (const [x1, y1, x2, y2] of lines) {
        for (const [x, y] of [
          [x1, y1],
          [x2, y2],
        ] as const) {
          expect(x).toBeGreaterThanOrEqual(-1e-6);
          expect(x).toBeLessThanOrEqual(2800 + 1e-6);
          expect(y).toBeGreaterThanOrEqual(-1e-6);
          expect(y).toBeLessThanOrEqual(2070 + 1e-6);
        }
        const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        const diff = (((a - angle) % 180) + 180) % 180;
        expect(Math.min(diff, 180 - diff)).toBeLessThan(1e-6);
      }
    }
  });

  it('is empty without grain', () => {
    expect(grainLines(100, 100, null, 10)).toEqual([]);
    expect(grainLines(0, 100, 0, 10)).toEqual([]);
  });
});
