import { DEFAULT_HOLD_LIMITS, type HoldLimits } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import { tabHeightBounds } from './tab-bounds';

// T343: the Kesim ayarları height texts follow the stock's traits row.
const t = tr.simulation.cutting;

describe('tabHeightBounds (T343)', () => {
  it("today's row: 18 mm → 1–17 mm, too high names 1 mm below the thickness", () => {
    const b = tabHeightBounds(t, 18, DEFAULT_HOLD_LIMITS);
    expect(b).toMatchObject({ min: 1, max: 17 });
    expect(b.message).toBe('1–17 mm arası olmalı.');
    expect(b.highMessage).toBe('Çok yüksek: en fazla 17 mm (kalınlık − 1 mm).');
    expect(tabHeightBounds(t, 1.5, DEFAULT_HOLD_LIMITS).message).toBe(
      '1,5 mm plakada köprü bırakılamaz (en az 2 mm gerekir); köprüyü kapatın.',
    );
  });

  it('a row with other bounds changes the texts (1,5 mm metal-like stock)', () => {
    const metal: HoldLimits = {
      ...DEFAULT_HOLD_LIMITS,
      tabs: {
        ...DEFAULT_HOLD_LIMITS.tabs,
        bounds: { minWidth: 2, minAnchor: 3, minHeight: 0.5, belowThickness: 0.5 },
      },
    };
    const b = tabHeightBounds(t, 1.5, metal);
    expect(b).toMatchObject({ min: 0.5, max: 1 });
    expect(b.message).toBe('0,5–1 mm arası olmalı.');
    expect(b.highMessage).toBe('Çok yüksek: en fazla 1 mm (kalınlık − 0,5 mm).');
  });
});
