import { maxTabHeight, type HoldLimits } from '@nittcam/core';
import { fill } from './fill';
import type { Messages } from './messages';

type Text = Messages['simulation']['cutting'];

const mmFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

/**
 * Tab height range for the Kesim ayarları field (T293, B44): "çok yüksek" above the top; on a
 * sheet thinner than min + the row's margin no height holds, so the range is never shown reversed
 * ("1–0,5 mm"). T343: the bounds are the stock material's (traits row).
 */
export function tabHeightBounds(t: Text, thickness: number, limits: HoldLimits) {
  const { minHeight: min, belowThickness } = limits.tabs.bounds;
  const max = maxTabHeight(thickness, limits);
  const f = (v: number) => mmFormat.format(v);
  if (max < min) {
    const none = fill(t.bounds.heightNone, {
      thickness: f(thickness),
      need: f(min + belowThickness),
    });
    return { min, max: min - 1, message: none, highMessage: none };
  }
  return {
    min,
    max,
    message: fill(t.bounds.height, { min: f(min), max: f(max) }),
    highMessage: fill(t.bounds.heightHigh, { max: f(max), below: f(belowThickness) }),
  };
}
