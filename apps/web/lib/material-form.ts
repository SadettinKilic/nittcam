/**
 * Form model of the material library dialog (T121). Pure: the draft keeps `null` for empty or
 * unparsable number fields; `toMaterial` validates and returns the entry or the field errors.
 */
import {
  libraryMaterialSchema,
  materialHasGrain,
  type LibraryMaterial,
  type MaterialKind,
  type MaterialTone,
} from '@nittcam/core';

export interface MaterialDraft {
  name: string;
  kind: MaterialKind;
  tone: MaterialTone;
  thicknesses: (number | null)[];
  sheets: { width: number | null; height: number | null }[];
  grainOn: boolean;
  grain: number | null;
}

export type MaterialFormErrors = Partial<Record<'name' | 'thicknesses' | 'sheets' | 'grain', true>>;

export function emptyDraft(): MaterialDraft {
  return {
    name: '',
    kind: 'mdf',
    tone: 'natural',
    thicknesses: [18],
    sheets: [{ width: 2800, height: 2070 }],
    grainOn: false,
    grain: 0,
  };
}

export function draftFrom(m: LibraryMaterial): MaterialDraft {
  return {
    name: m.name,
    kind: m.kind,
    tone: m.tone,
    thicknesses: [...m.thicknesses],
    sheets: m.sheetSizes.map((s) => ({ width: s.width, height: s.height })),
    grainOn: m.grain !== null,
    grain: m.grain ?? 0,
  };
}

/** The entry for the API, or the fields to fix. Empty rows are ignored; plastics have no grain. */
export function toMaterial(
  d: MaterialDraft,
): { ok: true; material: LibraryMaterial } | { ok: false; errors: MaterialFormErrors } {
  const errors: MaterialFormErrors = {};
  const thicknesses = d.thicknesses.filter((t): t is number => t !== null);
  const sheets = d.sheets.filter(
    (s): s is { width: number; height: number } => s.width !== null && s.height !== null,
  );
  const grain = materialHasGrain(d.kind) && d.grainOn ? d.grain : null;
  if (d.name.trim() === '') errors.name = true;
  if (thicknesses.length === 0 || thicknesses.some((t) => !(t > 0 && t <= 200))) {
    errors.thicknesses = true;
  }
  if (sheets.length === 0 || sheets.some((s) => !(s.width > 0 && s.height > 0))) {
    errors.sheets = true;
  }
  if (
    materialHasGrain(d.kind) &&
    d.grainOn &&
    (d.grain === null || d.grain < 0 || d.grain >= 180)
  ) {
    errors.grain = true;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const parsed = libraryMaterialSchema.safeParse({
    kind: d.kind,
    name: d.name,
    thicknesses,
    tone: d.tone,
    grain,
    sheetSizes: sheets,
  });
  if (!parsed.success) {
    const out: MaterialFormErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === 'name') out.name = true;
      else if (key === 'thicknesses') out.thicknesses = true;
      else if (key === 'sheetSizes') out.sheets = true;
      else if (key === 'grain') out.grain = true;
    }
    return { ok: false, errors: out };
  }
  return { ok: true, material: parsed.data };
}
