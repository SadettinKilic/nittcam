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
    'Set the sheet grain direction: 0 = along the sheet width (X), 90 = along the height (Y).',
  aiTool: true,
  params: stockSchema.shape.sheet.pick({ grain: true }),
  apply: (draft, params) => {
    draft.stock.sheet.grain = params.grain;
  },
});
