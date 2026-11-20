import type { GrainDialLabels } from '@nittcam/ui';
import { formatNumberTr } from '@nittcam/ui';
import { fill } from './fill';
import { getMessages, type Messages } from './messages';

/** GrainDial labels from the translation file (T115). */
export function grainDialLabels(
  m: Messages['grainDial'] = getMessages().grainDial,
  opts: { note?: boolean } = {},
): GrainDialLabels {
  return {
    label: m.label,
    valueText: (deg) => fill(m.valueText, { deg: formatNumberTr(deg, { maxDecimals: 1 }) }),
    noGrain: m.noGrain,
    input: m.input,
    quick: m.quick,
    ...(opts.note === false ? {} : { note: m.note }),
  };
}
