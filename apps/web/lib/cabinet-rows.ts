/** Cabinet generator rows for the cut list (T122, T260), shared by the dialog and T292. */
import type { CabinetPart } from '@nittcam/core';
import type { Messages } from './messages';

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const fmt = (v: number) => nf.format(v);

/**
 * Generated rows as `importCutList` input: a plain row each (D-041), the group only a label. A part
 * in another thickness than the stock (added on purpose, T260) carries it as a note ("8 mm").
 */
export function cabinetRows(
  parts: readonly CabinetPart[],
  names: Messages['cutList']['cabinet']['roles'],
  group: string,
  newId: () => string,
  stockThickness?: number,
) {
  return parts.map((p) => ({
    id: newId(),
    name: names[p.role],
    qty: p.qty,
    ...(group.trim() ? { group: group.trim() } : {}),
    ...(stockThickness !== undefined && Math.abs(p.thickness - stockThickness) > 1e-6
      ? { note: `${fmt(p.thickness)} mm` }
      : {}),
    grain: p.grain,
    params: { w: p.w, h: p.h, r: 0 },
    edgeBand: p.edgeBand,
  }));
}
