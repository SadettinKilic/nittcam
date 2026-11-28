import type { GrainDialLabels } from '@nittcam/ui';
import { formatNumberTr } from '@nittcam/ui';
import { fill } from './fill';
import type { Messages } from './messages';

/** GrainDial labels from the translation file (T115); client code passes `useMessages().grainDial`. */
export function grainDialLabels(
  m: Messages['grainDial'],
  opts: { note?: boolean; direction?: Messages['direction']['grain'] } = {},
): GrainDialLabels {
  // T347: aluminium / ACM name their direction ("Yüzey yönü", "Film oku"); wood keeps today's texts.
  const d = opts.direction;
  if (d) m = { ...m, label: d.label, input: d.input, note: d.note };
  return {
    label: m.label,
    valueText: (deg) => fill(m.valueText, { deg: formatNumberTr(deg, { maxDecimals: 1 }) }),
    noGrain: m.noGrain,
    input: m.input,
    quick: m.quick,
    ...(opts.note === false ? {} : { note: m.note }),
  };
}
