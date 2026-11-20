/**
 * Rows of the Ayarlar → DXF katmanları editor (T182) ↔ the company layer map (T145). Layer names
 * are case-insensitive (`layerKey`), so "Kesim" and "KESIM " are the same layer.
 */
import { layerKey, mergeLayerMap, type DxfLayerMap, type DxfLayerOp } from '@nittcam/core';

export interface LayerRow {
  /** Client-only key of the row. */
  id: string;
  name: string;
  op: DxfLayerOp;
}

export type LayerRowError = 'empty' | 'duplicate';

/** Stored map → rows, sorted by layer name (Turkish order). */
export function mapToLayerRows(map: Readonly<DxfLayerMap>, newId: () => string): LayerRow[] {
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b, 'tr'))
    .map(([name, op]) => ({ id: newId(), name, op }));
}

/** Row id → problem: an empty name, or a name another row already has (both rows marked). */
export function layerRowErrors(rows: readonly LayerRow[]): Record<string, LayerRowError> {
  const out: Record<string, LayerRowError> = {};
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    const key = layerKey(r.name);
    if (!key) {
      out[r.id] = 'empty';
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), r.id]);
  }
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) out[id] = 'duplicate';
  }
  return out;
}

/** Rows → the map to save (keys normalised, empty names and `auto` dropped). */
export function layerRowsToMap(rows: readonly LayerRow[]): DxfLayerMap {
  const chosen: Record<string, DxfLayerOp> = {};
  for (const r of rows) {
    const key = layerKey(r.name);
    if (key) chosen[key] = r.op;
  }
  return mergeLayerMap({}, chosen);
}
