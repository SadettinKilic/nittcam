/**
 * Form model of the material library dialog (T121). Pure: the draft keeps `null` for empty or
 * unparsable number fields; `toMaterial` validates and returns the entry or the field errors.
 */
import { cleanProps, libraryMaterialSchema, traitsOf, type LibraryMaterial } from '@nittcam/core';

export {
  draftFrom,
  emptyDraft,
  type MaterialDraft,
  type MaterialFormErrors,
} from './material-draft';
import type { MaterialDraft, MaterialFormErrors } from './material-draft';

/** The entry for the API, or the fields to fix. Empty rows are ignored; plastics have no grain. */
export function toMaterial(
  d: MaterialDraft,
): { ok: true; material: LibraryMaterial } | { ok: false; errors: MaterialFormErrors } {
  const errors: MaterialFormErrors = {};
  const thicknesses = d.thicknesses.filter((t): t is number => t !== null);
  const sheets = d.sheets.flatMap((s) =>
    s.width !== null && s.height !== null
      ? [{ width: s.width, height: s.height, ...(s.qty !== null ? { qty: s.qty } : {}) }]
      : [],
  );
  const grain = traitsOf(d.kind).direction.kind !== 'none' && d.grainOn ? d.grain : null;
  if (d.name.trim() === '') errors.name = true;
  if (thicknesses.length === 0 || thicknesses.some((t) => !(t > 0 && t <= 200))) {
    errors.thicknesses = true;
  }
  if (
    sheets.length === 0 ||
    sheets.some(
      (s) =>
        !(s.width > 0 && s.height > 0) ||
        (s.qty !== undefined && !(Number.isInteger(s.qty) && s.qty >= 1)),
    )
  ) {
    errors.sheets = true;
  }
  if (
    traitsOf(d.kind).direction.kind !== 'none' &&
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
    // T350: only the kind's own fields (a kind change leaves no stale alloy)
    props: cleanProps(d.kind, d.props),
  });
  if (!parsed.success) {
    const out: MaterialFormErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === 'name') out.name = true;
      else if (key === 'thicknesses') out.thicknesses = true;
      else if (key === 'sheetSizes') out.sheets = true;
      else if (key === 'grain') out.grain = true;
      else if (key === 'props') out.props = true;
    }
    return { ok: false, errors: out };
  }
  return { ok: true, material: parsed.data };
}
