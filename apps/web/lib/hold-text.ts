/**
 * MB4 (leftover of MB2/MB3): the holding bounds a toolpath text names, from the stock's traits
 * (`holdLimitsOf`): tab width / height bounds, the tab anchor, the thin skin bounds. Wood and
 * plastic give today's 3 / 1 / 0,2 mm; ACM and aluminium their own (§4.2 / §4.5).
 */
import { holdLimitsOf } from '@nittcam/core';

const tr = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');

export function holdTextValues(material: string): Record<string, string> {
  const l = holdLimitsOf(material);
  const b = l.tabs.bounds;
  return {
    anchor: tr(b.minAnchor),
    tabMinWidth: tr(b.minWidth),
    tabMinHeight: tr(b.minHeight),
    tabBelow: tr(b.belowThickness),
    smallMinCount: tr(l.tabs.defaults.smallPartMinCount),
    skinMin: tr(l.skin.min),
    skinBelow: tr(l.skin.belowThickness),
  };
}
