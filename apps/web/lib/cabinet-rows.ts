/** Cabinet generator rows for the cut list (T122, T260), shared by the dialog and T292. */
import { enteredSize, type CabinetPart, type DimensionMode } from '@nittcam/core';
import { fill } from './fill';
import type { Messages } from './messages';

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const fmt = (v: number) => nf.format(v);

/**
 * Generated rows as `importCutList` input: a plain row each (D-041), the group only a label. A part
 * in another thickness than the stock (added on purpose, T260) carries it as a note ("8 mm").
 * The generator gives finished sizes (with the band); in `cut` mode the band is taken off so the
 * entered cut size gives the same finished part (T316, D-105: a door gap stays the gap).
 */
export function cabinetRows(
  parts: readonly CabinetPart[],
  names: Messages['cutList']['cabinet']['roles'],
  group: string,
  newId: () => string,
  opts: { mode: DimensionMode; stockThickness?: number },
) {
  const { mode, stockThickness } = opts;
  return parts.map((p) => ({
    id: newId(),
    name: names[p.role],
    qty: p.qty,
    ...(group.trim() ? { group: group.trim() } : {}),
    ...(stockThickness !== undefined && Math.abs(p.thickness - stockThickness) > 1e-6
      ? { note: `${fmt(p.thickness)} mm` }
      : {}),
    grain: p.grain,
    params: { ...enteredSize(p, p.edgeBand, mode), r: 0 },
    edgeBand: p.edgeBand,
  }));
}

/** "Dolap N" with the first N not used as a group yet. */
export function nextCabinetName(pattern: string, groups: readonly (string | undefined)[]): string {
  const used = new Set(groups);
  for (let n = 1; ; n++) {
    const name = fill(pattern, { n });
    if (!used.has(name)) return name;
  }
}
