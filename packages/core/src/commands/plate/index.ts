/** Plate and machine commands (spec §5.1 "Plaka ve makine"). */
import { z } from 'zod';
import {
  dimensionModeSchema,
  machineRefSchema,
  projectSheetSizeSchema,
  stockSchema,
} from '../../schema';
import { defineCommand } from '../types';

/** Selects the machine profile the project uses. Selecting is allowed for AI; editing a profile is not. */
export const setMachine = defineCommand({
  name: 'setMachine',
  area: 'plate',
  description: 'Select the machine profile (id and profile version) used by the project.',
  aiTool: true,
  params: machineRefSchema,
  apply: (draft, params) => {
    draft.machine = { machineId: params.machineId, profileVersion: params.profileVersion };
  },
});

export const setMaterial = defineCommand({
  name: 'setMaterial',
  area: 'plate',
  description: 'Set the stock material id (for example "mdf" or "melamine-chipboard").',
  aiTool: true,
  params: z.strictObject({ material: stockSchema.shape.material }),
  apply: (draft, params) => {
    draft.stock.material = params.material;
    // A hand-picked material no longer comes from a library entry (T121).
    delete draft.stock.libraryId;
  },
});

/**
 * Picks a stock from the company material library in one undo step (T121): material kind,
 * thickness, sheet size and sheet grain together. The caller resolves the entry (core has no
 * database); `libraryId` only remembers which entry it was.
 */
export const applyLibraryMaterial = defineCommand({
  name: 'applyLibraryMaterial',
  area: 'plate',
  description:
    'Use a material of the company library: sets the material, thickness (mm), sheet size (mm) ' +
    'and sheet grain (degrees or null) at once and remembers the library entry id.',
  // Library ids come from the company database; the AI picks a material with setMaterial.
  aiTool: false,
  params: z.strictObject({
    libraryId: z.string().min(1).max(64),
    material: stockSchema.shape.material,
    thickness: stockSchema.shape.thickness,
    width: stockSchema.shape.sheet.shape.width,
    height: stockSchema.shape.sheet.shape.height,
    grain: stockSchema.shape.sheet.shape.grain,
  }),
  apply: (draft, params) => {
    draft.stock.libraryId = params.libraryId;
    draft.stock.material = params.material;
    draft.stock.thickness = params.thickness;
    draft.stock.sheet.width = params.width;
    draft.stock.sheet.height = params.height;
    draft.stock.sheet.grain = params.grain;
    // The size list belonged to the previous stock: the library entry gives one size (T164).
    delete draft.stock.sheets;
  },
});

export const setThickness = defineCommand({
  name: 'setThickness',
  area: 'plate',
  description: 'Set the stock thickness in millimetres.',
  aiTool: true,
  params: z.strictObject({ thickness: stockSchema.shape.thickness }),
  apply: (draft, params) => {
    draft.stock.thickness = params.thickness;
  },
});

export const setSheetSize = defineCommand({
  name: 'setSheetSize',
  area: 'plate',
  description:
    'Set the sheet size in millimetres: width along X, height along Y. Grain is not changed.',
  aiTool: true,
  params: stockSchema.shape.sheet.pick({ width: true, height: true }),
  apply: (draft, params) => {
    draft.stock.sheet.width = params.width;
    draft.stock.sheet.height = params.height;
    // With several stock sizes the default sheet is the first listed one (T164): it changes with
    // it, keeps its stock quantity, and a later entry of the same size is dropped.
    const list = draft.stock.sheets;
    if (list && list[0]) {
      list[0].width = params.width;
      list[0].height = params.height;
      draft.stock.sheets = list.filter(
        (s, i) => i === 0 || s.width !== params.width || s.height !== params.height,
      );
    }
  },
});

/**
 * The stock sheet sizes the nesting may use, in order, with optional stock quantities (T164,
 * D-056). The first size becomes the default sheet (grain unchanged). One size without a
 * quantity is stored as the plain single size (no `stock.sheets`), exactly as before T164.
 */
export const setStockSheets = defineCommand({
  name: 'setStockSheets',
  area: 'plate',
  description:
    'Set the stock sheet sizes the nesting may use (mm), first = default sheet; optional qty = ' +
    'sheets in stock (absent = no limit). Sizes must differ.',
  aiTool: false,
  params: z.strictObject({
    sheets: z
      .array(projectSheetSizeSchema)
      .min(1, { error: 'at least one sheet size' })
      .max(8, { error: 'at most 8 sheet sizes' })
      .refine((l) => new Set(l.map((s) => `${s.width}x${s.height}`)).size === l.length, {
        error: 'sheet sizes must differ',
      }),
  }),
  apply: (draft, params) => {
    const [first] = params.sheets;
    if (!first) return;
    draft.stock.sheet.width = first.width;
    draft.stock.sheet.height = first.height;
    if (params.sheets.length === 1 && first.qty === undefined) delete draft.stock.sheets;
    else draft.stock.sheets = params.sheets.map((s) => ({ ...s }));
  },
});

export const setGrain = defineCommand({
  name: 'setGrain',
  area: 'plate',
  description:
    'Set the sheet grain angle in degrees [0, 180): 0 = along the sheet width (X), 90 = along the ' +
    'height (Y), any angle in between allowed; null = the sheet has no grain.',
  aiTool: true,
  params: stockSchema.shape.sheet.pick({ grain: true }),
  apply: (draft, params) => {
    draft.stock.sheet.grain = params.grain;
  },
});

/**
 * Thin skin on or off (T143, §6.3 "son pasoda ince tabaka bırak"): `thickness` mm of skin under
 * small parts instead of tabs, cut through by a cleanup pass at the end of each sheet; `null` =
 * tabs (the default). A safety setting the user chooses: not an AI tool.
 */
export const setThinSkin = defineCommand({
  name: 'setThinSkin',
  area: 'plate',
  description:
    'Hold small parts with a thin skin (thickness in mm, less than the stock thickness) instead of tabs; null = tabs.',
  aiTool: false,
  params: z.strictObject({
    thickness: z
      .number({ error: 'thickness must be a finite number (mm)' })
      .positive({ error: 'thickness must be greater than 0' })
      .nullable(),
  }),
  check: (project, p) =>
    p.thickness !== null && !(p.thickness < project.stock.thickness)
      ? `skin thickness ${p.thickness} mm must be less than the stock thickness (${project.stock.thickness} mm)`
      : undefined,
  apply: (draft, p) => {
    if (p.thickness === null) delete draft.cutting.skin;
    else draft.cutting.skin = { thickness: p.thickness };
  },
});

/**
 * How entered part sizes are read (spec §4.8, T169): `cut` = the sizes are cut sizes; `finished` =
 * the sizes are finished sizes and the edge-band thickness is deducted from the cut size. One undo
 * step; nesting and toolpath read the cut size (`toCutSizes`).
 */
export const setDimensionMode = defineCommand({
  name: 'setDimensionMode',
  area: 'plate',
  description:
    'Set how entered part sizes are read: "cut" = cut sizes, "finished" = finished sizes (the edge band thickness of each banded edge is deducted from the cut size). Run nesting afterwards.',
  aiTool: false,
  params: z.strictObject({ mode: dimensionModeSchema }),
  apply: (draft, p) => {
    if (draft.settings.dimensionMode !== p.mode) draft.settings.dimensionMode = p.mode;
  },
});
