/**
 * Draft of the material library dialog (T121). Its own module without zod (T186): the list page
 * builds drafts eagerly, the validating form model (`material-form`) loads with the dialog.
 */
import type { LibraryMaterial, MaterialKind, MaterialProps, MaterialTone } from '@nittcam/core';

export interface MaterialDraft {
  name: string;
  kind: MaterialKind;
  tone: MaterialTone;
  thicknesses: (number | null)[];
  /** `qty` null = no limit (T164). */
  sheets: { width: number | null; height: number | null; qty: number | null }[];
  grainOn: boolean;
  grain: number | null;
  /** T350: kind-specific properties (only the kind's fields are saved). */
  props: MaterialProps;
}

export type MaterialFormErrors = Partial<
  Record<'name' | 'thicknesses' | 'sheets' | 'grain' | 'props', true>
>;

export function emptyDraft(): MaterialDraft {
  return {
    name: '',
    kind: 'mdf',
    tone: 'natural',
    thicknesses: [18],
    sheets: [{ width: 2800, height: 2070, qty: null }],
    grainOn: false,
    grain: 0,
    props: {},
  };
}

export function draftFrom(m: LibraryMaterial): MaterialDraft {
  return {
    name: m.name,
    kind: m.kind,
    tone: m.tone,
    thicknesses: [...m.thicknesses],
    sheets: m.sheetSizes.map((s) => ({ width: s.width, height: s.height, qty: s.qty ?? null })),
    grainOn: m.grain !== null,
    grain: m.grain ?? 0,
    props: { ...(m.props ?? {}) },
  };
}
