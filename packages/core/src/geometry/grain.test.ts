import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allowedRotations,
  mirrorGrain,
  normalizeGrain,
  normalizeRotation,
  turnGrain,
} from './grain';
import type { QuarterTurn } from './transform';

const angle = fc.double({ min: 0, max: 179.999, noNaN: true });
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe('grain follows the piece (D-038)', () => {
  it('normalises to [0, 180)', () => {
    expect(normalizeGrain(210)).toBe(30);
    expect(normalizeGrain(-30)).toBe(150);
    expect(normalizeGrain(180)).toBe(0);
    expect(Object.is(normalizeGrain(-0), 0)).toBe(true);
  });

  it('a quarter turn turns the grain with the shape', () => {
    expect(turnGrain(0, 90)).toBe(90);
    expect(turnGrain(90, 90)).toBe(0);
    expect(turnGrain(30, 90)).toBe(120);
    expect(turnGrain(30, 180)).toBe(30);
    expect(turnGrain(30, 270)).toBe(120);
  });

  it('mirroring reflects the grain line', () => {
    expect(mirrorGrain(0)).toBe(0);
    expect(mirrorGrain(90)).toBe(90);
    expect(mirrorGrain(30)).toBe(150);
  });

  it('rotating 90° four times is the identity', () => {
    fc.assert(
      fc.property(angle, (a) => {
        let g = a;
        for (let i = 0; i < 4; i++) g = turnGrain(g, 90);
        close(g, normalizeGrain(a));
      }),
    );
  });

  it('turns compose: 90 + 270 and 180 + 180 are the identity', () => {
    fc.assert(
      fc.property(angle, fc.constantFrom<QuarterTurn>(90, 180, 270), (a, t) => {
        const back = (360 - t) as QuarterTurn;
        close(turnGrain(turnGrain(a, t), back), normalizeGrain(a));
      }),
    );
  });

  it('mirroring twice is the identity', () => {
    fc.assert(
      fc.property(angle, (a) => {
        close(mirrorGrain(mirrorGrain(a)), normalizeGrain(a));
      }),
    );
  });
});

describe('allowedRotations (D-034)', () => {
  const sheetAngle = fc.integer({ min: 0, max: 179_999 }).map((n) => n / 1000);
  const partAngle = sheetAngle;
  const mod = (a: number, m: number) => ((a % m) + m) % m;

  it('fixed: exactly g and g + 180 with g = sheet − part', () => {
    expect(allowedRotations({ grain: { mode: 'fixed', angle: 0 } }, { grain: 0 })).toEqual([
      0, 180,
    ]);
    expect(allowedRotations({ grain: { mode: 'fixed', angle: 0 } }, { grain: 90 })).toEqual([
      90, 270,
    ]);
    expect(allowedRotations({ grain: { mode: 'fixed', angle: 60 } }, { grain: 90 })).toEqual([
      30, 210,
    ]);
    expect(allowedRotations({ grain: { mode: 'fixed', angle: 120 } }, { grain: 0 })).toEqual([
      60, 240,
    ]);
  });

  it('free parts and sheets without grain: quarter turns (or the policy)', () => {
    expect(allowedRotations({ grain: { mode: 'free', angle: 30 } }, { grain: 0 })).toEqual([
      0, 90, 180, 270,
    ]);
    expect(allowedRotations({ grain: { mode: 'fixed', angle: 30 } }, { grain: null })).toEqual([
      0, 90, 180, 270,
    ]);
    expect(
      allowedRotations(
        { grain: { mode: 'free', angle: 0 } },
        { grain: 0 },
        { freeRotations: [0, 360, 45] },
      ),
    ).toEqual([0, 45]);
  });

  it('property: every allowed rotation of a fixed part puts its grain on the sheet grain', () => {
    fc.assert(
      fc.property(sheetAngle, partAngle, (s, p) => {
        const rots = allowedRotations({ grain: { mode: 'fixed', angle: p } }, { grain: s });
        expect(rots).toHaveLength(2);
        for (const rot of rots) {
          expect(rot).toBeGreaterThanOrEqual(0);
          expect(rot).toBeLessThan(360);
          expect(normalizeRotation(rot)).toBe(rot);
          const diff = mod(p + rot - s, 180);
          expect(Math.min(diff, 180 - diff)).toBeLessThan(1e-6);
        }
        expect(mod((rots[1] ?? 0) - (rots[0] ?? 0), 360)).toBeCloseTo(180, 6);
      }),
      { numRuns: 300 },
    );
  });
});
