import { describe, expect, it } from 'vitest';
import { canvasTouchClass, isZoomedIn } from './use-media-query';

describe('canvas touch rule (T198)', () => {
  it('lets the page scroll with one finger only while the canvas is not zoomed', () => {
    expect(canvasTouchClass(false)).toBe('touch-pan-y');
    expect(canvasTouchClass(true)).toBe('touch-none');
  });
  it('treats the fit scale (±1 %) as not zoomed', () => {
    expect(isZoomedIn(0.2, 0.2)).toBe(false);
    expect(isZoomedIn(0.201, 0.2)).toBe(false);
    expect(isZoomedIn(0.25, 0.2)).toBe(true);
    expect(isZoomedIn(0.15, 0.2)).toBe(false);
    expect(isZoomedIn(1, 0)).toBe(false);
  });
});
