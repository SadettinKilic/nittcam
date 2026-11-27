/** Plate and machine commands (spec §5.1 "Plaka ve makine"). */
import { z } from 'zod';
import {
  dimensionModeSchema,
  machineRefSchema,
  projectSheetSizeSchema,
  FEED_BOUNDS,
  PLUNGE_FEED_BOUNDS,
  SPINDLE_RPM_BOUNDS,
  entrySchema,
  stockSchema,
} from '../../schema';
import { feedInRange, findTool, machineFeedLimits } from '../../machine/profile';
import { rpmInRange } from '../../toolpath/spindle';
import { OPERATION_TOOL_KINDS } from '../../toolpath/op-tools';
import { operationToolProblem, operationToolProblemText } from '../../toolpath/op-tool-choice';
import { SKIN_BOUNDS, holdLimitsOf, maxSkinThickness, maxTabHeight } from '../../toolpath/tabs';
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
  description: `Hold small parts with a thin skin instead of tabs (thickness in mm, for wood and plastic at least ${SKIN_BOUNDS.min} mm and at most the stock thickness minus ${SKIN_BOUNDS.belowThickness} mm; the bounds follow the stock material); null = tabs.`,
  aiTool: false,
  params: z.strictObject({
    thickness: z
      .number({ error: 'thickness must be a finite number (mm)' })
      .positive({ error: 'thickness must be greater than 0 mm' })
      .nullable(),
  }),
  // T298 (CTO #12 A, D-083): a skin outside the bounds does not hold the part. T343: the bounds
  // are the stock material's (traits row).
  check: (project, p) => {
    if (p.thickness === null) return undefined;
    const limits = holdLimitsOf(project.stock.material);
    const t = project.stock.thickness;
    if (p.thickness < limits.skin.min - 1e-9) {
      return `thickness must be at least ${limits.skin.min} mm`;
    }
    return p.thickness > maxSkinThickness(t, limits) + 1e-9
      ? `skin thickness ${p.thickness} mm must be at most ${maxSkinThickness(t, limits)} mm (stock thickness ${t} mm minus ${limits.skin.belowThickness} mm)`
      : undefined;
  },
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

/** T288: how parts are held while cut (§6.3, D-022), as the Simülasyon "Kesim ayarları" offers it. */
export const tabModeSchema = z.enum(['all', 'small', 'off'], {
  error: 'mode must be "all", "small" or "off"',
});

/** Thin skin the "off" choice starts with, mm (at most half the stock thickness). */
export const OFF_SKIN_DEFAULT = 0.5;

const tabOverride = <T extends z.ZodNumber>(n: T) => n.nullable().optional();

/**
 * Tabs (T288, §6.3 "Tab: adet, genişlik ve yükseklik ayarlanır"). `mode`:
 * - `all`: tabs on every part (`tabs.auto`; a thin skin chosen on step 1 stays on small parts);
 * - `small`: tabs only where the small-part safety rule needs them (§6.3, always on);
 * - `off`: no tabs at all; small parts are held by a thin skin instead (§6.3 "ikinci seçenek"),
 *   so the safety rule still holds every small part (§7.2).
 * `count` / `width` / `height` override the material set's tab values; `null` = back to the
 * material set (or the built-in default). A safety setting the user chooses: not an AI tool.
 */
export const setTabs = defineCommand({
  name: 'setTabs',
  area: 'plate',
  description:
    'Set the tabs: mode "all" (every part), "small" (only small parts, the safety rule) or "off" (no tabs; small parts get a thin skin); count, width and height in mm override the material set (null = material set).',
  aiTool: false,
  params: z.strictObject({
    mode: tabModeSchema.optional(),
    count: tabOverride(
      z
        .number({ error: 'count must be a number' })
        .int({ error: 'count must be a whole number' })
        .min(1, { error: 'count must be at least 1' })
        .max(20, { error: 'count must be at most 20' }),
    ),
    width: tabOverride(
      z.number({ error: 'width must be a number' }).positive({ error: 'width must be > 0 mm' }),
    ),
    height: tabOverride(
      z.number({ error: 'height must be a number' }).positive({ error: 'height must be > 0 mm' }),
    ),
  }),
  // T293 (CTO #11 A, D-069): a bridge below these sizes does not hold the part. T343: the bounds
  // are the stock material's (traits row).
  check: (project, p) => {
    const limits = holdLimitsOf(project.stock.material);
    const b = limits.tabs.bounds;
    const t = project.stock.thickness;
    if (p.width !== undefined && p.width !== null && p.width < b.minWidth) {
      return `width must be at least ${b.minWidth} mm`;
    }
    if (p.height === undefined || p.height === null) return undefined;
    if (p.height < b.minHeight) return `height must be at least ${b.minHeight} mm`;
    return p.height > maxTabHeight(t, limits)
      ? `tab height ${p.height} mm must be at most ${maxTabHeight(t, limits)} mm (stock thickness ${t} mm minus ${b.belowThickness} mm)`
      : undefined;
  },
  apply: (draft, p) => {
    const tabs = draft.cutting.tabs;
    if (p.mode !== undefined) {
      tabs.auto = p.mode === 'all';
      // `all` keeps a skin chosen on step 1 (small parts: skin, others: tabs).
      if (p.mode === 'small') delete draft.cutting.skin;
      else if (p.mode === 'off' && !draft.cutting.skin) {
        draft.cutting.skin = {
          thickness: Math.min(OFF_SKIN_DEFAULT, draft.stock.thickness / 2),
        };
      }
    }
    if (p.count === null) delete tabs.count;
    else if (p.count !== undefined) tabs.count = p.count;
    if (p.width === null) delete tabs.width;
    else if (p.width !== undefined) tabs.width = p.width;
    if (p.height === null) delete tabs.height;
    else if (p.height !== undefined) tabs.height = p.height;
  },
});

/** Lead-in / lead-out shape (T288, §6.3 "lead-in ve lead-out (yay veya düz)"). */
export const setLeadIn = defineCommand({
  name: 'setLeadIn',
  area: 'plate',
  description: 'Set the lead-in and lead-out shape: "arc" or "line".',
  aiTool: false,
  params: z.strictObject({
    leadIn: z.enum(['arc', 'line'], { error: 'leadIn must be "arc" or "line"' }),
  }),
  apply: (draft, p) => {
    draft.cutting.leadIn = p.leadIn;
  },
});

/** Cut direction (T288, §6.3 "climb / conventional seçimi"). */
export const setCutDirection = defineCommand({
  name: 'setCutDirection',
  area: 'plate',
  description: 'Set the cut direction: "climb" or "conventional".',
  aiTool: false,
  params: z.strictObject({
    direction: z.enum(['climb', 'conventional'], {
      error: 'direction must be "climb" or "conventional"',
    }),
  }),
  apply: (draft, p) => {
    draft.cutting.direction = p.direction;
  },
});

/**
 * T307 (D-098): spindle speed (devir) for one tool of this project, rpm; `null` = back to the
 * recommended value (the material set's). With the selected machine the value must lie inside its
 * spindle range and the tool must be in its tool table; the validation, the toolpath and the post
 * check the range again. A machine setting the user chooses: not an AI tool.
 */
export const setSpindleRpm = defineCommand({
  name: 'setSpindleRpm',
  area: 'plate',
  description:
    'Set the spindle speed (rpm) of one tool for this project, inside the machine spindle range; null = the recommended value of the material set.',
  aiTool: false,
  params: z.strictObject({
    tool: z
      .number({ error: 'tool must be a number' })
      .int({ error: 'tool must be a whole number' })
      .min(1, { error: 'tool must be 1–99' })
      .max(99, { error: 'tool must be 1–99' }),
    rpm: z
      .number({ error: 'rpm must be a number' })
      .int({ error: 'rpm must be a whole number' })
      .min(SPINDLE_RPM_BOUNDS.min, { error: `rpm must be at least ${SPINDLE_RPM_BOUNDS.min}` })
      .max(SPINDLE_RPM_BOUNDS.max, { error: `rpm must be at most ${SPINDLE_RPM_BOUNDS.max}` })
      .nullable(),
  }),
  check: (_project, p, env) => {
    const machine = env.machine;
    if (!machine) return undefined;
    if (!findTool(machine, p.tool)) return `tool T${p.tool} is not in the machine profile`;
    if (p.rpm !== null && !rpmInRange(machine, p.rpm)) {
      return `spindle speed ${p.rpm} rpm is outside the machine's range ${machine.spindle.minRpm}–${machine.spindle.maxRpm}`;
    }
    return undefined;
  },
  apply: (draft, p) => {
    const key = String(p.tool);
    if (p.rpm === null) {
      const own = draft.cutting.spindleRpm;
      if (!own || !(key in own)) return;
      const rest = Object.fromEntries(Object.entries(own).filter(([k]) => k !== key));
      if (Object.keys(rest).length === 0) delete draft.cutting.spindleRpm;
      else draft.cutting.spindleRpm = rest;
      return;
    }
    draft.cutting.spindleRpm ??= {};
    draft.cutting.spindleRpm[key] = p.rpm;
  },
});

/**
 * T323: cutting feed and/or plunge feed (mm/min) of one tool for this project; a field set to
 * `null` = back to the recommended value (the tool's material set), an absent field is left as is.
 * With the selected machine the values must lie inside `machineFeedLimits` and the tool must be in
 * its tool table; the validation, the toolpath and the post check the range again. A machine
 * setting the user chooses: not an AI tool.
 */
export const setToolFeed = defineCommand({
  name: 'setToolFeed',
  area: 'plate',
  description:
    'Set the cutting feed and/or plunge feed (mm/min) of one tool for this project, inside the machine limits; null = the recommended value of the material set.',
  aiTool: false,
  params: z
    .strictObject({
      tool: z
        .number({ error: 'tool must be a number' })
        .int({ error: 'tool must be a whole number' })
        .min(1, { error: 'tool must be 1–99' })
        .max(99, { error: 'tool must be 1–99' }),
      feed: z
        .number({ error: 'feed must be a number' })
        .min(FEED_BOUNDS.min, { error: `feed must be at least ${FEED_BOUNDS.min}` })
        .max(FEED_BOUNDS.max, { error: `feed must be at most ${FEED_BOUNDS.max}` })
        .nullable()
        .optional(),
      plungeFeed: z
        .number({ error: 'plunge feed must be a number' })
        .min(PLUNGE_FEED_BOUNDS.min, {
          error: `plunge feed must be at least ${PLUNGE_FEED_BOUNDS.min}`,
        })
        .max(PLUNGE_FEED_BOUNDS.max, {
          error: `plunge feed must be at most ${PLUNGE_FEED_BOUNDS.max}`,
        })
        .nullable()
        .optional(),
    })
    .refine((p) => p.feed !== undefined || p.plungeFeed !== undefined, {
      error: 'give feed or plungeFeed',
    }),
  check: (_project, p, env) => {
    const machine = env.machine;
    if (!machine) return undefined;
    if (!findTool(machine, p.tool)) return `tool T${p.tool} is not in the machine profile`;
    const limits = machineFeedLimits(machine);
    if (typeof p.feed === 'number' && !feedInRange(limits.feed, p.feed)) {
      return `feed ${p.feed} mm/min is outside the machine's range ${limits.feed.min}–${limits.feed.max}`;
    }
    if (typeof p.plungeFeed === 'number' && !feedInRange(limits.plungeFeed, p.plungeFeed)) {
      return `plunge feed ${p.plungeFeed} mm/min is outside the machine's range ${limits.plungeFeed.min}–${limits.plungeFeed.max}`;
    }
    return undefined;
  },
  apply: (draft, p) => {
    const key = String(p.tool);
    const row: { feed?: number | undefined; plungeFeed?: number | undefined } = {
      ...(draft.cutting.feeds?.[key] ?? {}),
    };
    if (p.feed === null) delete row.feed;
    else if (p.feed !== undefined) row.feed = p.feed;
    if (p.plungeFeed === null) delete row.plungeFeed;
    else if (p.plungeFeed !== undefined) row.plungeFeed = p.plungeFeed;
    const rest = Object.fromEntries(
      Object.entries(draft.cutting.feeds ?? {}).filter(([k]) => k !== key),
    );
    if (row.feed !== undefined || row.plungeFeed !== undefined) rest[key] = row;
    if (Object.keys(rest).length === 0) delete draft.cutting.feeds;
    else draft.cutting.feeds = rest;
  },
});

/**
 * T324: how contour passes enter the material: `straight` = vertical plunge (the default),
 * `ramp` = zig-zag along the contour, each leg at most `angleDeg` steep and at least `length` mm
 * long (`null` = the tool diameter). A project setting: not an AI tool.
 */
export const setEntry = defineCommand({
  name: 'setEntry',
  area: 'plate',
  description:
    'Set how contour passes enter the material: straight plunge, or a ramp along the contour with an angle (degrees) and a minimum length (mm).',
  aiTool: false,
  params: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('straight') }),
    z.strictObject({
      type: z.literal('ramp'),
      angleDeg: entrySchema.shape.angleDeg,
      length: entrySchema.shape.length.unwrap().nullable(),
    }),
  ]),
  apply: (draft, p) => {
    if (p.type === 'straight') {
      delete draft.cutting.entry;
      return;
    }
    draft.cutting.entry =
      p.length === null
        ? { type: 'ramp', angleDeg: p.angleDeg }
        : { type: 'ramp', angleDeg: p.angleDeg, length: p.length };
  },
});

/**
 * T308 (D-099): the cutting tool of one operation of this job (`outer` / `inner` contour,
 * `pocket` = blind pockets and grooves, `hole` = through holes); `null` = back to the default
 * (the material set's tool for contours, each hole's own tool for holes). With the selected
 * machine the tool must suit the operation on this job (`operationToolProblem`: type, flute
 * length, diameter rules); the validation and the toolpath check again. Not an AI tool.
 */
export const setOperationTool = defineCommand({
  name: 'setOperationTool',
  area: 'plate',
  description:
    'Choose the cutting tool of one operation (outer, inner, pocket, hole) for this project; null = the default tool.',
  aiTool: false,
  params: z.strictObject({
    op: z.enum(OPERATION_TOOL_KINDS, { error: 'op must be "outer", "inner", "pocket" or "hole"' }),
    tool: z
      .number({ error: 'tool must be a number' })
      .int({ error: 'tool must be a whole number' })
      .min(1, { error: 'tool must be 1–99' })
      .max(99, { error: 'tool must be 1–99' })
      .nullable(),
  }),
  check: (project, p, env) => {
    const machine = env.machine;
    if (!machine || p.tool === null) return undefined;
    const problem = operationToolProblem(project, machine, p.op, p.tool);
    return problem === null
      ? undefined
      : `tool T${p.tool} does not suit the ${p.op} operation of this job (${operationToolProblemText(project, problem)})`;
  },
  apply: (draft, p) => {
    if (p.tool === null) {
      const own = draft.cutting.tools;
      if (!own || own[p.op] === undefined) return;
      const rest = Object.fromEntries(Object.entries(own).filter(([k]) => k !== p.op));
      if (Object.keys(rest).length === 0) delete draft.cutting.tools;
      else draft.cutting.tools = rest;
      return;
    }
    draft.cutting.tools ??= {};
    draft.cutting.tools[p.op] = p.tool;
  },
});
