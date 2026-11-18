import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isSnappedGrainAngle,
  normalizeGrainAngle,
  pointerToGrainAngle,
  polarToScreen,
  snapGrainAngle,
  stepGrainAngle,
} from './angle';

describe('normalizeGrainAngle', () => {
  it('wraps into [0, 180)', () => {
    expect(normalizeGrainAngle(0)).toBe(0);
    expect(normalizeGrainAngle(180)).toBe(0);
    expect(normalizeGrainAngle(210)).toBe(30);
    expect(normalizeGrainAngle(-30)).toBe(150);
    expect(normalizeGrainAngle(-180)).toBe(0);
    expect(normalizeGrainAngle(359.9999)).toBe(0);
    expect(normalizeGrainAngle(Number.NaN)).toBe(0);
  });

  it('is idempotent, in range and equal mod 180', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), (a) => {
        const n = normalizeGrainAngle(a);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(180);
        expect(normalizeGrainAngle(n)).toBe(n);
        expect(normalizeGrainAngle(a + 180)).toBeCloseTo(n, 2);
      }),
    );
  });
});

describe('pointerToGrainAngle', () => {
  it('reads screen offsets counter-clockwise from +x', () => {
    expect(pointerToGrainAngle(10, 0)).toBe(0);
    expect(pointerToGrainAngle(0, -10)).toBe(90); // up on screen
    expect(pointerToGrainAngle(-10, 0)).toBe(0); // other end of the same line
    expect(pointerToGrainAngle(0, 10)).toBe(90);
    expect(pointerToGrainAngle(10, -10)).toBe(45);
    expect(pointerToGrainAngle(-10, -10)).toBe(135);
    expect(pointerToGrainAngle(-10, 10)).toBe(45); // 225° = 45°
    expect(pointerToGrainAngle(0, 0)).toBeNull();
  });

  it('both ends of a diameter give the same angle', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        (x, y) => {
          fc.pre(x !== 0 || y !== 0);
          expect(pointerToGrainAngle(x, y)).toBe(pointerToGrainAngle(-x, -y));
        },
      ),
    );
  });

  it('round-trips with polarToScreen', () => {
    for (let a = 0; a < 180; a += 1) {
      const p = polarToScreen(60, 60, 40, a);
      expect(pointerToGrainAngle(p.x - 60, p.y - 60)).toBe(a);
    }
  });
});

describe('snapGrainAngle', () => {
  it('snaps within ±3° of a 45° multiple', () => {
    expect(snapGrainAngle(43)).toBe(45);
    expect(snapGrainAngle(48.5)).toBe(48.5);
    expect(snapGrainAngle(48)).toBe(45);
    expect(snapGrainAngle(49)).toBe(49);
    expect(snapGrainAngle(2)).toBe(0);
    expect(snapGrainAngle(178)).toBe(0);
    expect(snapGrainAngle(93)).toBe(90);
    expect(snapGrainAngle(132)).toBe(135);
    expect(snapGrainAngle(30)).toBe(30);
  });

  it('never moves an angle by more than the tolerance', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 179 }), (a) => {
        const s = snapGrainAngle(a);
        const d = Math.abs(s - a);
        expect(Math.min(d, 180 - d)).toBeLessThanOrEqual(3);
      }),
    );
  });

  it('marks snapped angles', () => {
    expect(isSnappedGrainAngle(0)).toBe(true);
    expect(isSnappedGrainAngle(135)).toBe(true);
    expect(isSnappedGrainAngle(180)).toBe(true);
    expect(isSnappedGrainAngle(30)).toBe(false);
  });
});

describe('stepGrainAngle', () => {
  it('wraps keyboard steps', () => {
    expect(stepGrainAngle(0, -1)).toBe(179);
    expect(stepGrainAngle(179, 1)).toBe(0);
    expect(stepGrainAngle(170, 15)).toBe(5);
    expect(stepGrainAngle(30, 15)).toBe(45);
  });
});
