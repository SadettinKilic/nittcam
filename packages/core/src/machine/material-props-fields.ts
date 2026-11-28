/**
 * T350 material properties: the zod-free part (fields per family, clean, match, header words), so
 * client pages that only read props (project cards, offcut dialog) do not pull zod into their
 * bundle (T186, spec §8.2). The schema and `MaterialProps` live in `material-props.ts`. Pure.
 */
import { materialKindOf } from './material';
import type { MaterialKind } from './material-kinds';
import { traitsOf, type MaterialFamily } from './material-traits';
import type { MaterialPropKey, MaterialProps } from './material-props';

/** Aluminium surface finish (analysis §4.4): raw, brushed (satine), anodised. */
export const ALUMINIUM_FINISHES = ['raw', 'brushed', 'anodized'] as const;
export type AluminiumFinish = (typeof ALUMINIUM_FINISHES)[number];

/** The properties each family uses (analysis §4.4); empty = none (wood and plastic). */
export const PROPS_FIELDS: Readonly<Record<MaterialFamily, readonly MaterialPropKey[]>> = {
  woodBoard: [],
  plastic: [],
  composite: ['colorCode', 'metallic', 'skin'],
  nonFerrous: ['alloy', 'temper', 'finish', 'film'],
};

/** The property keys a kind uses (none for an unknown material). */
export function propsFieldsOf(kind: MaterialKind | null): readonly MaterialPropKey[] {
  return kind === null ? [] : PROPS_FIELDS[traitsOf(kind).family];
}

/**
 * The properties of `props` the kind uses, without empty values; `{}` when none. Used when a
 * library entry changes kind, when the stock is picked and when an offcut is stored.
 */
export function cleanProps(
  kind: MaterialKind | null,
  props: MaterialProps | undefined,
): MaterialProps {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const k of propsFieldsOf(kind)) {
    const v = props[k];
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out as MaterialProps;
}

/** Whether a props object carries any value. */
export function hasProps(props: MaterialProps | undefined): props is MaterialProps {
  return props !== undefined && Object.keys(props).length > 0;
}

const norm = (s: string) => s.trim().toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');

/**
 * T350: whether an offcut fits the stock by its properties: the alloy and the colour code must be
 * the same when **both** sides have one (case and spacing ignored); a side without it matches any.
 * Kind and thickness are compared by the caller.
 */
export function propsMatch(
  stock: MaterialProps | undefined,
  offcut: MaterialProps | undefined,
): boolean {
  for (const k of ['alloy', 'colorCode'] as const) {
    const a = stock?.[k];
    const b = offcut?.[k];
    if (a !== undefined && b !== undefined && norm(a) !== norm(b)) return false;
  }
  return true;
}

/**
 * The words a header adds to the kind name (§9.1, analysis §4.2 "PDF başlığı"): the aluminium
 * alloy ("5754"), else nothing. The caller words the kind name itself.
 */
export function propsHeadSuffix(material: string, props: MaterialProps | undefined): string {
  const fields = propsFieldsOf(materialKindOf(material));
  return fields.includes('alloy') && props?.alloy ? props.alloy : '';
}
