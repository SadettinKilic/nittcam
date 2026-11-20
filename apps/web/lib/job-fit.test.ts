import { describe, expect, it } from 'vitest';
import { fitView, jobBox } from './job-fit';

const SHEET = { width: 2800, height: 2070 };

describe('jobBox (B44 fit to job)', () => {
  it('is null without parts and on a full sheet', () => {
    expect(jobBox([], SHEET)).toBeNull();
    expect(jobBox([{ x: 10, y: 10, w: 2700, h: 2000 }], SHEET)).toBeNull();
  });

  it('frames a small job in the corner with a margin, inside the sheet', () => {
    const b = jobBox(
      [
        { x: 10, y: 10, w: 300, h: 200 },
        { x: 330, y: 10, w: 200, h: 400 },
      ],
      SHEET,
    );
    expect(b).not.toBeNull();
    if (!b) return;
    // Margin max(20, 8 % of 520) = 41.6 mm, clipped at the sheet edge.
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.width).toBeCloseTo(530 + 41.6, 6);
    expect(b.height).toBeCloseTo(410 + 41.6, 6);
  });

  it('a long strip along the whole width gains nothing: sheet fit stays', () => {
    expect(jobBox([{ x: 0, y: 0, w: 2800, h: 200 }], SHEET)).toBeNull();
  });
});

describe('fitView', () => {
  it('without a box centres the whole sheet', () => {
    const v = fitView(SHEET, 1000, 800, 30, 0);
    expect(v.x).toBeCloseTo((1000 - 2800 * v.scale) / 2, 9);
    expect(v.y).toBeCloseTo((800 - 2070 * v.scale) / 2, 9);
  });

  it('with a box centres that box on screen (Y up in the sheet, down on screen)', () => {
    const box = { x: 100, y: 200, width: 400, height: 300 };
    const v = fitView(SHEET, 1000, 800, 30, 0, box);
    expect(v.scale).toBeCloseTo(Math.min(940 / 400, 740 / 300), 9);
    // Box centre (300, 350) mm → screen centre (500, 400).
    const cx = v.x + 300 * v.scale;
    const cy = v.y + (SHEET.height - 350) * v.scale;
    expect(cx).toBeCloseTo(500, 6);
    expect(cy).toBeCloseTo(400, 6);
  });
});
