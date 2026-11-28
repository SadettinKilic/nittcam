/**
 * Kind-specific material properties (T350, spec §3.4 / §9.1, analysis §4.4): a library entry, the
 * project stock picked from it and an offcut may carry them. Aluminium: alloy, temper, finish,
 * film; ACM: colour code, metallic, skin. Today's kinds carry none (`{}`). The fields of a kind
 * come from its family (`traits.family`), so a new kind of a family needs no change here. Pure.
 * The zod-free helpers live in `material-props-fields.ts`, so client pages that only read props
 * do not load zod (T186 budget).
 */
import { z } from 'zod';
import { ALUMINIUM_FINISHES } from './material-props-fields';

const shortText = (max: number) =>
  z
    .string({ error: 'must be a string' })
    .trim()
    .min(1, { error: 'must not be empty' })
    .max(max, { error: `at most ${max} characters` });

/** Every property any family may carry; which ones a kind may use: `PROPS_FIELDS` (`material-props-fields.ts`). */
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
