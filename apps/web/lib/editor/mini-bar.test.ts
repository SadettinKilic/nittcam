import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { miniBarRailClear } from './mini-bar';

const rail = { left: 30, top: 30, w: 40, h: 260 };
const bounds = { maxLeft: 200, maxTop: 700 };
const bar = (left: number, top: number) => ({ left, top, w: 186, h: 38 });

describe('miniBarRailClear', () => {
  it('keeps a bar that does not touch the rail', () => {
    expect(miniBarRailClear(bar(120, 400), rail, bounds)).toEqual({ left: 120, top: 400 });
  });

  it('moves an overlapping bar to the right of the rail', () => {
    expect(miniBarRailClear(bar(26, 60), rail, bounds)).toEqual({ left: 74, top: 60 });
  });

  it('moves it below the rail when there is no room on the right', () => {
    expect(miniBarRailClear(bar(26, 60), rail, { maxLeft: 50, maxTop: 700 })).toEqual({
      left: 26,
      top: 294,
    });
  });

  it('ignores an unmeasured rail', () => {
    expect(miniBarRailClear(bar(26, 60), { ...rail, w: 0, h: 0 }, bounds)).toEqual({
      left: 26,
      top: 60,
    });
  });

  it('never intersects the rail when the canvas has room right of it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 700 }), (l, t) => {
        const r = miniBarRailClear(bar(l, t), rail, bounds);
        const b = { ...bar(r.left, r.top) };
        const overlap =
          b.left < rail.left + rail.w &&
          rail.left < b.left + b.w &&
          b.top < rail.top + rail.h &&
          rail.top < b.top + b.h;
        expect(overlap).toBe(false);
        expect(r.left).toBeLessThanOrEqual(bounds.maxLeft);
      }),
    );
  });
});
