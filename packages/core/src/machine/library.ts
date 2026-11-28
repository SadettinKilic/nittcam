/**
 * Company material & stock library (T121, spec §3.4 "Ayarlar → Malzemeler", §3.6, §4.1).
 *
 * A library entry names a board the workshop stocks: its kind, the thicknesses on hand, the stock
 * sheet sizes, a colour/texture key and the default sheet grain. Cutting parameters are not copied
 * here: they stay in each machine profile's material sets (D-029) and are linked by kind +
 * thickness, so one profile edit updates every library entry (D-044). Pure.
 */
import { z } from 'zod';
import { EPS } from '../geometry/constants';
import { grainAngleSchema } from '../schema/project';
import { materialPropsSchema, type MaterialProps } from './material-props';
import { cleanProps } from './material-props-fields';
import { materialKindSchema } from './profile';

/** Colour / texture keys of a board (drives the swatch; the 3D materials of M6 reuse them). */
export const materialToneSchema = z.enum(
  // T350: aluminium, silver (ACM metallic) and brass for the metal kinds
  [
    'natural',
    'oak',
    'walnut',
    'white',
    'grey',
    'anthracite',
    'black',
    'clear',
    'aluminium',
    'silver',
    'brass',
  ],
  { error: 'unknown colour / texture' },
);
export type MaterialTone = z.infer<typeof materialToneSchema>;

const mm = z
  .number({ error: 'must be a number (mm)' })
  .positive({ error: 'must be a positive length in mm' })
  .max(10_000, { error: 'at most 10.000 mm' });

/**
 * A stock sheet size, stored with the long side along X (`width ≥ height` is not required).
 * `qty` (T164, D-056): how many sheets of this size are in stock; absent = no limit.
 */
export const stockSheetSizeSchema = z.strictObject({
  width: mm,
  height: mm,
  qty: z
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(1, { error: 'must be an integer >= 1' })
    .max(100_000, { error: 'at most 100.000' })
    .optional(),
});
export type StockSheetSize = z.infer<typeof stockSheetSizeSchema>;

/** Most thicknesses / sheet sizes per entry (a sanity bound for the form and the API). */
export const LIBRARY_MAX_THICKNESSES = 12;
export const LIBRARY_MAX_SHEET_SIZES = 8;

export const libraryMaterialSchema = z
  .strictObject({
    kind: materialKindSchema,
    name: z
      .string({ error: 'must be a string' })
      .trim()
      .min(1, { error: 'name is required' })
      .max(60, { error: 'at most 60 characters' }),
    thicknesses: z
      .array(mm.max(200, { error: 'at most 200 mm' }))
      .min(1, { error: 'give at least one thickness' })
      .max(LIBRARY_MAX_THICKNESSES, { error: `at most ${LIBRARY_MAX_THICKNESSES} thicknesses` })
      .transform(uniqueSorted),
    tone: materialToneSchema,
    /** Default sheet grain in degrees [0, 180); `null` = no grain. */
    grain: grainAngleSchema.nullable(),
    sheetSizes: z
      .array(stockSheetSizeSchema)
      .min(1, { error: 'give at least one sheet size' })
      .max(LIBRARY_MAX_SHEET_SIZES, { error: `at most ${LIBRARY_MAX_SHEET_SIZES} sheet sizes` })
      .transform(uniqueSizes),
    /**
     * T350 (§3.4, analysis §4.4): kind-specific properties (`MaterialProps`); absent = `{}`. Fields
     * the kind does not use are dropped (an entry whose kind changed keeps no stale alloy).
     */
    props: materialPropsSchema.default({}),
  })
  .transform((m) => ({ ...m, props: cleanProps(m.kind, m.props) as MaterialProps }));
export type LibraryMaterial = z.output<typeof libraryMaterialSchema>;
export type LibraryMaterialInput = z.input<typeof libraryMaterialSchema>;

function uniqueSorted(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length === 0 || Math.abs((out[out.length - 1] ?? 0) - v) > EPS) out.push(v);
  }
  return out;
}

function uniqueSizes(sizes: StockSheetSize[]): StockSheetSize[] {
  const out: StockSheetSize[] = [];
  for (const s of sizes) {
    const dup = out.some(
      (o) => Math.abs(o.width - s.width) <= EPS && Math.abs(o.height - s.height) <= EPS,
    );
    if (!dup) out.push({ width: s.width, height: s.height, ...(s.qty ? { qty: s.qty } : {}) });
  }
  return out;
}

const SEED_SIZES: StockSheetSize[] = [
  { width: 2800, height: 2070 },
  { width: 2440, height: 1220 },
];

/** Seed of a new company's library (T121): MDF 18, Kontrplak 18, Melamin 18, Akrilik 5. */
export const DEFAULT_LIBRARY: readonly LibraryMaterial[] = (
  [
    ['mdf', 'MDF', 18, 'natural', null],
    ['plywood', 'Kontrplak', 18, 'oak', 0],
    ['melamine', 'Melamin', 18, 'white', 0],
    ['acrylic', 'Akrilik', 5, 'clear', null],
  ] as const
).map(([kind, name, thickness, tone, grain]) => ({
  kind,
  name,
  thicknesses: [thickness],
  tone,
  grain,
  sheetSizes: SEED_SIZES.map((s) => ({ ...s })),
  props: {},
}));

/**
 * The stock a library pick gives (T121, wizard step 1): the entry's kind, the current thickness
 * when the entry has it (else its first one), the current sheet when it is one of the entry's sizes
 * (else its first size) and the entry's default grain.
 */
export function stockFromLibrary(
  material: LibraryMaterial,
  current: { thickness: number; sheet: { width: number; height: number } },
): {
  material: string;
  thickness: number;
  width: number;
  height: number;
  grain: number | null;
  /** T350: the entry's properties, only when it has any (wood and plastic entries give none). */
  props?: MaterialProps;
} {
  const thickness =
    material.thicknesses.find((t) => Math.abs(t - current.thickness) <= EPS) ??
    material.thicknesses[0] ??
    current.thickness;
  const size =
    material.sheetSizes.find(
      (s) =>
        Math.abs(s.width - current.sheet.width) <= EPS &&
        Math.abs(s.height - current.sheet.height) <= EPS,
    ) ??
    material.sheetSizes[0] ??
    current.sheet;
  return {
    material: material.kind,
    thickness,
    width: size.width,
    height: size.height,
    grain: material.grain,
    ...(material.props && Object.keys(material.props).length > 0
      ? { props: { ...material.props } }
      : {}),
  };
}
