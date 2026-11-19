/**
 * "Dolap ekle" remembers the last used values per browser (T260): shelves, back, doors, edge band
 * and door gap. Width, height and depth always start from the defaults. Storage can be missing
 * or blocked (private window): every access is guarded and the dialog works without it.
 */
import { cabinetParamsSchema, DEFAULT_CABINET, type CabinetParams } from '@nittcam/core';

export const CABINET_STORAGE_KEY = 'nittcam-cabinet-last';

export type CabinetMemory = Pick<CabinetParams, 'shelves' | 'back' | 'doors' | 'band' | 'doorGap'>;

/** The remembered values in a stored string, or `null` when it is missing or not valid. */
export function parseCabinetMemory(raw: string | null): CabinetMemory | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<CabinetMemory> | null;
    if (!o || typeof o !== 'object') return null;
    const { shelves, back, doors, band, doorGap } = o;
    // Validated with the dialog's own schema, on top of the defaults.
    const r = cabinetParamsSchema.safeParse({
      ...DEFAULT_CABINET,
      shelves,
      back,
      doors,
      band,
      doorGap,
    });
    if (!r.success) return null;
    const d = r.data;
    return { shelves: d.shelves, back: d.back, doors: d.doors, band: d.band, doorGap: d.doorGap };
  } catch {
    return null;
  }
}

export function loadCabinetMemory(): CabinetMemory | null {
  try {
    return parseCabinetMemory(window.localStorage.getItem(CABINET_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveCabinetMemory(m: CabinetMemory): void {
  try {
    const { shelves, back, doors, band, doorGap } = m;
    window.localStorage.setItem(
      CABINET_STORAGE_KEY,
      JSON.stringify({ shelves, back, doors, band, doorGap }),
    );
  } catch {
    // Storage unavailable: the next dialog starts from the defaults.
  }
}
