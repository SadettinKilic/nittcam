/** Plate and machine commands (spec §5.1 "Plaka ve makine"). */
import { z } from 'zod';
import { machineRefSchema, stockSchema } from '../../schema';
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
