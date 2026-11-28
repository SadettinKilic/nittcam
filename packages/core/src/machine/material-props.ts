/**
 * Kind-specific material properties (T350, spec §3.4 / §9.1, analysis §4.4): a library entry, the
 * project stock picked from it and an offcut may carry them. Aluminium: alloy, temper, finish,
 * film; ACM: colour code, metallic, skin. Today's kinds carry none (`{}`). The fields of a kind
 * come from its family (`traits.family`), so a new kind of a family needs no change here. Pure.
 */
import { z } from 'zod';
import { materialKindOf } from './material';
import type { MaterialKind } from './material-kinds';
import { traitsOf, type MaterialFamily } from './material-traits';

const shortText = (max: number) =>
  z
    .string({ error: 'must be a string' })
    .trim()
    .min(1, { error: 'must not be empty' })
    .max(max, { error: `at most ${max} characters` });

/** Aluminium surface finish (analysis §4.4): raw, brushed (satine), anodised. */
export const ALUMINIUM_FINISHES = ['raw', 'brushed', 'anodized'] as const;
export type AluminiumFinish = (typeof ALUMINIUM_FINISHES)[number];

/** Every property any family may carry; which ones a kind may use: `PROPS_FIELDS`. */
export const materialPropsSchema = z.strictObject({
  /** Aluminium alloy, e.g. "5754". */
  alloy: shortText(20).optional(),
  /** Aluminium temper, e.g. "H22". */
  temper: shortText(10).optional(),
  finish: z.enum(ALUMINIUM_FINISHES, { error: 'must be raw, brushed or anodized' }).optional(),
  /** Protective film on the face. */
  film: z.boolean({ error: 'must be true or false' }).optional(),
  /** ACM colour code, e.g. "RAL 9006". */
  colorCode: shortText(30).optional(),
  /** ACM metallic / brushed colour (the film arrow matters). */
  metallic: z.boolean({ error: 'must be true or false' }).optional(),
  /** ACM aluminium skin thickness, mm (0,3 / 0,5). */
  skin: z
    .number({ error: 'must be a number (mm)' })
    .positive({ error: 'must be a positive length in mm' })
    .max(2, { error: 'at most 2 mm' })
    .optional(),
});
export type MaterialProps = z.infer<typeof materialPropsSchema>;
export type MaterialPropKey = keyof MaterialProps;

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
