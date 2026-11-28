import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MATERIAL_KIND_IDS } from '../machine/material-kinds';
import { MATERIAL_TRAITS } from '../machine/material-traits';
import {
  DEFAULT_HOLD_LIMITS,
  SKIN_BOUNDS,
  TAB_BOUNDS,
  TAB_DEFAULTS,
  defaultTabHeight,
  holdLimitsOf,
  maxSkinThickness,
  maxTabHeight,
  skinThicknessOk,
  tabSizeProblem,
} from './tabs';

// T343: the tab, skin and small-part limits take the stock's traits. For the six kinds of today
// (and an unknown material) the new functions give exactly the old module-constant results.

/** The functions as they were before T343 (module constants only). */
const old = {
  maxTabHeight: (t: number) => t - 1,
  tabSizeProblem: (w: number, h: number, t: number): 'width' | 'height' | null => {
    const eps = 1e-9;
    if (!(w >= 3 - eps)) return 'width';
    if (!(h >= 1 - eps) || h > t - 1 + eps) return 'height';
    return null;
  },
  maxSkinThickness: (t: number) => t - 1,
  skinThicknessOk: (s: number, t: number) => s >= 0.2 - 1e-9 && s <= t - 1 + 1e-9,
  defaultTabHeight: (t: number) => Math.min(3, t / 2),
};

const materialIds = [...MATERIAL_KIND_IDS, 'MDF', 'kontrplak', 'unknown-stuff', ''];

describe('hold limits from the traits (T343)', () => {
  it('the default limits are the old constants', () => {
    expect(DEFAULT_HOLD_LIMITS.tabs.bounds).toEqual(TAB_BOUNDS);
    expect(DEFAULT_HOLD_LIMITS.skin).toEqual(SKIN_BOUNDS);
    expect(DEFAULT_HOLD_LIMITS.smallPart).toEqual({
      area: TAB_DEFAULTS.smallPartArea,
      minSide: TAB_DEFAULTS.smallPartMinSide,
    });
    for (const k of MATERIAL_KIND_IDS) {
      expect(holdLimitsOf(k).tabs).toEqual(MATERIAL_TRAITS[k].tabs);
    }
  });

  it('old function = new function over random thickness, size and material', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...materialIds),
        fc.double({ min: 0.1, max: 80, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (material, t, a, b) => {
          const l = holdLimitsOf(material);
          expect(maxTabHeight(t, l)).toBe(old.maxTabHeight(t));
          expect(tabSizeProblem(a, b, t, l)).toBe(old.tabSizeProblem(a, b, t));
          expect(maxSkinThickness(t, l)).toBe(old.maxSkinThickness(t));
          expect(skinThicknessOk(b, t, l)).toBe(old.skinThicknessOk(b, t));
          expect(defaultTabHeight(t, l)).toBe(old.defaultTabHeight(t));
          // the default argument is today's row
          expect(tabSizeProblem(a, b, t)).toBe(old.tabSizeProblem(a, b, t));
          expect(defaultTabHeight(t)).toBe(old.defaultTabHeight(t));
        },
      ),
      { numRuns: 500 },
    );
  });
});
