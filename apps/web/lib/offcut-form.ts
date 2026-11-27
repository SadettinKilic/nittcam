/** "Artık parça ekle / düzelt" form (T291): values, checks, and the API body. */
import { traitsOf, materialKindOf, type MaterialKind } from '@nittcam/core';
import type { NewOffcut, OffcutItem } from './offcuts-api';

/** Same bounds as the API (`isMm`). */
export const OFFCUT_MAX_MM = 10_000;

export interface OffcutFormValues {
  material: string;
  thickness: number | null;
  /** En (mm). */
  width: number | null;
  /** Boy (mm). */
  height: number | null;
  grain: 0 | 90 | null;
}

export const emptyOffcutForm = (material: MaterialKind = 'mdf'): OffcutFormValues => ({
  material,
  thickness: 18,
  width: null,
  height: null,
  grain: traitsOf(material).direction.kind !== 'none' ? 0 : null,
});

export function offcutFormOf(o: OffcutItem): OffcutFormValues {
  return {
    material: o.material,
    thickness: o.thickness,
    width: o.width,
    height: o.height,
    grain: o.grain === 0 || o.grain === 90 ? o.grain : null,
  };
}

const mm = (v: number | null): v is number =>
  v !== null && Number.isFinite(v) && v > 0 && v <= OFFCUT_MAX_MM;

/**
 * The API body for the values, or null when a size is missing or out of range. A material without
 * grain (plastics) always sends grain null.
 */
export function offcutBody(v: OffcutFormValues): Omit<NewOffcut, 'sourceProjectId'> | null {
  if (v.material.trim() === '' || !mm(v.thickness) || !mm(v.width) || !mm(v.height)) return null;
  const grain = traitsOf(materialKindOf(v.material)).direction.kind !== 'none' ? v.grain : null;
  return {
    material: v.material,
    thickness: v.thickness,
    width: v.width,
    height: v.height,
    grain,
  };
}

/** The fields an edit changes (empty = nothing to save). */
export function offcutChanges(
  item: OffcutItem,
  body: Omit<NewOffcut, 'sourceProjectId'>,
): Partial<Omit<NewOffcut, 'sourceProjectId'>> {
  const out: Partial<Omit<NewOffcut, 'sourceProjectId'>> = {};
  if (body.material !== item.material) out.material = body.material;
  if (body.thickness !== item.thickness) out.thickness = body.thickness;
  if (body.width !== item.width) out.width = body.width;
  if (body.height !== item.height) out.height = body.height;
  if (body.grain !== item.grain) out.grain = body.grain;
  return out;
}
