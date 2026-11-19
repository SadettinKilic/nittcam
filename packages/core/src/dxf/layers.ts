/**
 * DXF layer → operation mapping (T145, spec §4.6 "Katman eşleme"), stored as a company setting.
 * DXF layer names are case-insensitive, so keys are trimmed and upper-cased.
 */
import { z } from 'zod';

/**
 * What a layer's contours become:
 * - `auto`: by geometry (outermost closed = part, inside = inner contour; spec §4.6)
 * - `outside`: always a part outline (dış kesim)
 * - `inside`: always an inner contour of the part around it (iç kesim)
 * - `drill`: delik; circles are hole candidates, other shapes inner contours
 * - `pocket`: cep, and `online`: çizgi üzerinden: per-contour operations arrive with T142; until
 *   then these contours are reported and not imported
 * - `ignore`: not imported
 */
export const DXF_LAYER_OPS = ['auto', 'outside', 'inside', 'drill', 'pocket', 'online', 'ignore'] as const;
export const dxfLayerOpSchema = z.enum(DXF_LAYER_OPS, { error: 'unknown layer operation' });
export type DxfLayerOp = z.infer<typeof dxfLayerOpSchema>;

/** Operations the import can apply today (the others wait for T142 per-contour operations). */
export const DXF_LAYER_OPS_READY: readonly DxfLayerOp[] = ['auto', 'outside', 'inside', 'drill', 'ignore'];

/** Most layers one company keeps a mapping for. */
export const MAX_DXF_LAYER_MAP = 500;

/** Normalised key of a layer name. */
export function layerKey(name: string): string {
  return name.trim().toUpperCase();
}

/** Company setting: layer key → operation. */
export const dxfLayerMapSchema = z
  .record(
    z
      .string()
      .min(1, { error: 'layer name must not be empty' })
      .max(255, { error: 'layer name is at most 255 characters' }),
    dxfLayerOpSchema,
  )
  .refine((m) => Object.keys(m).length <= MAX_DXF_LAYER_MAP, {
    error: `at most ${MAX_DXF_LAYER_MAP} layers`,
  });
export type DxfLayerMap = z.infer<typeof dxfLayerMapSchema>;

/** Operation of a layer under a mapping (unmapped = `auto`). */
export function layerOp(map: Readonly<DxfLayerMap>, layer: string): DxfLayerOp {
  return map[layerKey(layer)] ?? 'auto';
}

/**
 * Merges the operations chosen in one import into the stored mapping (keys normalised). `auto`
 * entries are dropped, since unmapped already means auto. Keeps the result within the limit by
 * keeping the newest choices.
 */
export function mergeLayerMap(
  stored: Readonly<DxfLayerMap>,
  chosen: Readonly<Record<string, DxfLayerOp>>,
): DxfLayerMap {
  const out: DxfLayerMap = {};
  const fresh = new Map<string, DxfLayerOp>();
  for (const [name, op] of Object.entries(chosen)) {
    const key = layerKey(name);
    if (key) fresh.set(key, op);
  }
  for (const [key, op] of Object.entries(stored)) {
    if (!fresh.has(key) && op !== 'auto') out[key] = op;
  }
  for (const [key, op] of fresh) if (op !== 'auto') out[key] = op;
  const keys = Object.keys(out);
  if (keys.length > MAX_DXF_LAYER_MAP) {
    for (const key of keys.slice(0, keys.length - MAX_DXF_LAYER_MAP)) delete out[key];
  }
  return out;
}
