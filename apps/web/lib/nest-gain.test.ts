import { describe, expect, it } from 'vitest';
import type { LayoutSummary } from '@nittcam/core';
import { copiesInHoles, rotationGainsNothing } from './nest-gain';

const frame = {
  key: 'f#0',
  x: 0,
  y: 0,
  w: 400,
  h: 400,
  inners: [[60, 60, 340, 60, 340, 340, 60, 340]],
};

describe('copiesInHoles (B44)', () => {
  it('counts a copy whose centre is in a cut-out of another copy', () => {
    expect(copiesInHoles([frame, { key: 'a#0', x: 100, y: 100, w: 50, h: 50, inners: [] }])).toBe(
      1,
    );
  });
  it('a copy beside the frame is not in a hole', () => {
    expect(copiesInHoles([frame, { key: 'a#0', x: 500, y: 100, w: 50, h: 50, inners: [] }])).toBe(
      0,
    );
  });
});

const summary = (sheetCount: number, wastePercent: number, unplaced = 0) =>
  ({
    sheetCount,
    wastePercent,
    unplaced: Array.from({ length: unplaced }),
  }) as unknown as LayoutSummary;

describe('rotationGainsNothing (B44)', () => {
  it('same sheets and waste: no gain', () => {
    expect(rotationGainsNothing(summary(2, 31.2), summary(2, 31.2))).toBe(true);
  });
  it('less waste or fewer sheets: a gain', () => {
    expect(rotationGainsNothing(summary(2, 29), summary(2, 31.2))).toBe(false);
    expect(rotationGainsNothing(summary(1, 40), summary(2, 31.2))).toBe(false);
  });
  it('fewer unplaced copies is a gain', () => {
    expect(rotationGainsNothing(summary(2, 35, 0), summary(2, 31, 1))).toBe(false);
  });
});
