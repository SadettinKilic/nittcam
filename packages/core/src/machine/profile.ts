/**
 * Machine profile v1 (spec §7.1, §6.4, §3.6, §4.5; D-016). All lengths in millimetres, feeds in
 * mm/min, spindle speed in rpm. Validation only: no I/O, clock or randomness.
 *
 * Messages are English. The UI translates issues by Zod issue code, bound (`minimum`/`maximum`)
 * and, for cross-field rules, by `params.key` (see `MachineProfileIssue`).
 */
import { z } from 'zod';
import { maxTabHeight, TAB_BOUNDS } from '../toolpath/tabs';

/** The machine profile schema version this build writes and reads. */
export const MACHINE_PROFILE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Bounds (sensible limits for CNC routers; a value outside is almost surely a typo)
// ---------------------------------------------------------------------------

export const PROFILE_BOUNDS = {
  /** X/Y travel and table size, mm. */
  axisXY: { max: 10_000 },
  /** Z travel, mm. */
  axisZ: { max: 1_000 },
  /** Through-cut depth into the spoilboard, mm. */
  spoilboardAllowance: { min: 0, max: 5 },
  spindlePowerKw: { max: 100 },
  rpm: { min: 1_000, max: 60_000 },
  warmupSeconds: { min: 0, max: 600 },
  toolCapacity: { min: 1, max: 99 },
  toolNumber: { min: 1, max: 99 },
  toolDiameter: { max: 50 },
  fluteLength: { max: 200 },
  flutes: { min: 1, max: 8 },
  tools: { min: 1, max: 99 },
  materialThickness: { max: 200 },
  feed: { min: 100, max: 60_000 },
  plungeFeed: { min: 50, max: 30_000 },
  /** Rapid traverse rate (G0), mm/min. */
  rapidFeed: { min: 500, max: 200_000 },
  stepDown: { max: 50 },
  tabCount: { min: 1, max: 20 },
  tabWidth: { max: 200 },
  tabHeight: { max: 200 },
  fileNameLength: { min: 8, max: 255 },
  fileSizeMb: { max: 4_096 },
  text: { max: 80 },
  notes: { max: 500 },
} as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const num = () => z.number({ error: 'must be a number' });
const int = () => z.number({ error: 'must be a number' }).int({ error: 'must be an integer' });
/** A strictly positive length up to `max` mm. */
const lengthUpTo = (max: number) => num().positive().max(max);
const requiredText = (max: number = PROFILE_BOUNDS.text.max) =>
  z.string({ error: 'must be a string' }).trim().min(1, { error: 'must not be empty' }).max(max);
const optionalText = (max: number = PROFILE_BOUNDS.text.max) =>
  z.string({ error: 'must be a string' }).trim().max(max);

/** Empty (no code) or an M code such as `M7` or `M10`. */
const mCode = z
  .string({ error: 'must be a string' })
  .trim()
  .toUpperCase()
  .regex(/^(M\d{1,3})?$/, { error: 'must be empty or an M code like M7' });

// ---------------------------------------------------------------------------
// Groups (spec §7.1 table)
// ---------------------------------------------------------------------------

/** Kimlik: marka, model, controller ailesi ve sürümü. */
export const machineIdentitySchema = z.strictObject({
  /** Display name in the machine list. */
  name: requiredText(),
  brand: optionalText().default(''),
  model: optionalText().default(''),
  controller: z.strictObject({
    /** Controller family (the machine library is keyed by family, §7.1), e.g. "Mach3". */
    family: requiredText(),
    version: optionalText().default(''),
  }),
  notes: optionalText(PROFILE_BOUNDS.notes.max).default(''),
});

/** Çalışma alanı: X, Y, Z travel (mm). */
export const workEnvelopeSchema = z.strictObject({
  x: lengthUpTo(PROFILE_BOUNDS.axisXY.max),
  y: lengthUpTo(PROFILE_BOUNDS.axisXY.max),
  z: lengthUpTo(PROFILE_BOUNDS.axisZ.max),
});

/** Tabla ölçüsü (mm): width along X, depth along Y. */
export const tableSizeSchema = z.strictObject({
  width: lengthUpTo(PROFILE_BOUNDS.axisXY.max),
  depth: lengthUpTo(PROFILE_BOUNDS.axisXY.max),
});

/** Program zero corner, seen from the operator's side of the machine. */
export const originCornerSchema = z.enum(['frontLeft', 'frontRight', 'backLeft', 'backRight'], {
  error: 'origin corner must be frontLeft, frontRight, backLeft or backRight',
});

/** Orijin: program zero corner, axis directions and where the sheet sits on the table. */
export const originSchema = z.strictObject({
  corner: originCornerSchema,
  /** Direction of +X (seen from the front). */
  xPositive: z.enum(['right', 'left'], { error: 'must be right or left' }),
  /** Direction of +Y (seen from the front). */
  yPositive: z.enum(['back', 'front'], { error: 'must be back or front' }),
  /** Sheet corner offset from program zero, mm (plakanın tabladaki yeri). */
  sheetOffset: z.strictObject({
    x: num().nonnegative().max(PROFILE_BOUNDS.axisXY.max),
    y: num().nonnegative().max(PROFILE_BOUNDS.axisXY.max),
  }),
});

/** Z sıfır referansı: table surface or material top; spoilboard allowance for through cuts. */
export const zZeroSchema = z.strictObject({
  reference: z.enum(['table', 'materialTop'], { error: 'must be table or materialTop' }),
  spoilboardAllowance: num()
    .min(PROFILE_BOUNDS.spoilboardAllowance.min)
    .max(PROFILE_BOUNDS.spoilboardAllowance.max),
});

export const spindleSchema = z
  .strictObject({
    powerKw: num().positive().max(PROFILE_BOUNDS.spindlePowerKw.max),
    minRpm: int().min(PROFILE_BOUNDS.rpm.min).max(PROFILE_BOUNDS.rpm.max),
    maxRpm: int().min(PROFILE_BOUNDS.rpm.min).max(PROFILE_BOUNDS.rpm.max),
    /** Warm-up dwell after spindle start, seconds (the post writes s or ms syntax, §6.4). */
    warmupSeconds: num()
      .min(PROFILE_BOUNDS.warmupSeconds.min)
      .max(PROFILE_BOUNDS.warmupSeconds.max),
  })
  .refine((s) => s.minRpm <= s.maxRpm, {
    error: 'minimum rpm must not exceed maximum rpm',
    path: ['minRpm'],
    params: { key: 'minAboveMax' },
  });

export const toolChangerSchema = z.strictObject({
  /** auto = `T.. M6`; manual = pause + message; none = one file per tool (§6.4). */
  type: z.enum(['auto', 'manual', 'none'], { error: 'must be auto, manual or none' }),
  /** Tool positions in the changer (only meaningful for `auto`). */
  capacity: int().min(PROFILE_BOUNDS.toolCapacity.min).max(PROFILE_BOUNDS.toolCapacity.max),
  /** Tool length compensation (G43) available. */
  lengthCompensation: z.boolean({ error: 'must be true or false' }),
});

/** Tutma: vacuum, clamp or T-slot; vacuum on/off M codes ('' = none). */
export const holdDownSchema = z.strictObject({
  type: z.enum(['vacuum', 'clamp', 'tSlot'], { error: 'must be vacuum, clamp or tSlot' }),
  vacuumOn: mCode,
  vacuumOff: mCode,
});

/** Program biçimi: which post config and which version (the config itself is T017). */
export const postRefSchema = z.strictObject({
  id: z
    .string({ error: 'must be a string' })
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,59}$/, { error: 'must be a lowercase id like generic or mach3' }),
  version: z
    .string({ error: 'must be a string' })
    .trim()
    .regex(/^\d{1,3}\.\d{1,3}(\.\d{1,3})?$/, { error: 'must be a version like 1.0 or 1.0.2' }),
});

/** Kısıtlar: what the controller accepts. */
export const constraintsSchema = z.strictObject({
  maxFileNameLength: int()
    .min(PROFILE_BOUNDS.fileNameLength.min)
    .max(PROFILE_BOUNDS.fileNameLength.max),
  maxFileSizeMb: num().positive().max(PROFILE_BOUNDS.fileSizeMb.max),
  arcs: z.boolean({ error: 'must be true or false' }),
  lineNumbers: z.boolean({ error: 'must be true or false' }),
  drillCycles: z.boolean({ error: 'must be true or false' }),
});

// ---------------------------------------------------------------------------
// Tool table and material parameter sets (spec §7.1, §3.6)
// ---------------------------------------------------------------------------

export const toolTypeSchema = z.enum(
  ['flatEndMill', 'ballEndMill', 'compression', 'vBit', 'drill'],
  { error: 'unknown tool type' },
);

export const toolSchema = z.strictObject({
  number: int().min(PROFILE_BOUNDS.toolNumber.min).max(PROFILE_BOUNDS.toolNumber.max),
  type: toolTypeSchema,
  diameter: lengthUpTo(PROFILE_BOUNDS.toolDiameter.max),
  fluteLength: lengthUpTo(PROFILE_BOUNDS.fluteLength.max),
  flutes: int().min(PROFILE_BOUNDS.flutes.min).max(PROFILE_BOUNDS.flutes.max),
});

/** Materials of the Oluştur sihirbazı (§3.6). Stone is "yakında" and not listed. */
export const materialKindSchema = z.enum(
  ['mdf', 'plywood', 'melamine', 'solidWood', 'acrylic', 'pvc'],
  { error: 'unknown material' },
);

/**
 * Tab defaults of a material parameter set (§3.6 "tab ayarı varsayılanları", §6.3, D-022). Optional:
 * a set without it uses the toolpath layer's built-in defaults (`TAB_DEFAULTS`).
 */
export const tabParamsSchema = z.strictObject({
  /** Tabs per part. */
  count: int().min(PROFILE_BOUNDS.tabCount.min).max(PROFILE_BOUNDS.tabCount.max),
  /** Bridge width along the contour, mm. */
  width: lengthUpTo(PROFILE_BOUNDS.tabWidth.max),
  /** Material left in the bridge, mm (tab top = −(thickness − height)); must be < thickness. */
  height: lengthUpTo(PROFILE_BOUNDS.tabHeight.max),
});

/** Defaults for one material + thickness on this machine (§3.6 "Malzeme = parametre seti"). */
export const materialParamsSchema = z.strictObject({
  material: materialKindSchema,
  thickness: lengthUpTo(PROFILE_BOUNDS.materialThickness.max),
  feed: num().min(PROFILE_BOUNDS.feed.min).max(PROFILE_BOUNDS.feed.max),
  plungeFeed: num().min(PROFILE_BOUNDS.plungeFeed.min).max(PROFILE_BOUNDS.plungeFeed.max),
  rpm: int().min(PROFILE_BOUNDS.rpm.min).max(PROFILE_BOUNDS.rpm.max),
  stepDown: lengthUpTo(PROFILE_BOUNDS.stepDown.max),
  /** Suggested tool number (must exist in the tool table). */
  tool: int().min(PROFILE_BOUNDS.toolNumber.min).max(PROFILE_BOUNDS.toolNumber.max),
  /** Tab defaults (optional; added in T015, older profiles stay valid). */
  tabs: tabParamsSchema.optional(),
  /**
   * The set's values were copied from another kind's set and not measured for this material
   * (D-046: the example machine's Melamin / Kontrplak 18 from MDF 18). The form shows a note and
   * drops the mark once the user edits the row. Optional; older profiles stay valid.
   */
  copiedFrom: materialKindSchema.optional(),
  /**
   * The set holds the form's generic starting values, added by the "Kesim ayarı ekle" fix flow
   * (T265, D-045/D-046), and nobody has confirmed them for this material. Such a set does not count
   * as configured: validation and the toolpath report `CUTTING_PARAMS_UNVERIFIED` until the user
   * confirms or edits the row (the form drops the mark). Optional; older profiles stay valid.
   */
  unverified: z.literal(true).optional(),
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Issue for a cross-field rule. `key` is the translation key the UI uses. */
function crossIssue(
  ctx: z.core.$RefinementCtx,
  path: (string | number)[],
  key: string,
  message: string,
): void {
  ctx.addIssue({ code: 'custom', path, message, params: { key } });
}

export const machineProfileSchema = z
  .strictObject({
    schemaVersion: z.literal(MACHINE_PROFILE_SCHEMA_VERSION, {
      error: `schemaVersion must be ${MACHINE_PROFILE_SCHEMA_VERSION}`,
    }),
    /** Seed/library profile shown as an example until the user edits and verifies it. */
    example: z.boolean().default(false),
    identity: machineIdentitySchema,
    workEnvelope: workEnvelopeSchema,
    table: tableSizeSchema,
    origin: originSchema,
    zZero: zZeroSchema,
    /** Safe Z height above Z zero for rapids, mm (§7.2 rule 2). */
    safeZ: lengthUpTo(PROFILE_BOUNDS.axisZ.max),
    /**
     * Rapid traverse rate (G0), mm/min, for the time estimate (T017; optional so older profiles
     * stay valid, the toolpath default is used without it).
     */
    rapidFeed: num().min(PROFILE_BOUNDS.rapidFeed.min).max(PROFILE_BOUNDS.rapidFeed.max).optional(),
    spindle: spindleSchema,
    toolChanger: toolChangerSchema,
    holdDown: holdDownSchema,
    post: postRefSchema,
    constraints: constraintsSchema,
    tools: z.array(toolSchema).min(PROFILE_BOUNDS.tools.min).max(PROFILE_BOUNDS.tools.max),
    materials: z.array(materialParamsSchema).max(200),
  })
  .superRefine((p, ctx) => {
    if (p.safeZ > p.workEnvelope.z) {
      crossIssue(ctx, ['safeZ'], 'safeZAboveTravel', 'safe Z must be within the Z travel');
    }
    if (p.holdDown.type === 'vacuum' && p.holdDown.vacuumOn === '' && p.holdDown.vacuumOff !== '') {
      crossIssue(
        ctx,
        ['holdDown', 'vacuumOn'],
        'vacuumOnMissing',
        'vacuum off code without on code',
      );
    }
    const seen = new Set<number>();
    p.tools.forEach((tool, i) => {
      if (seen.has(tool.number)) {
        crossIssue(
          ctx,
          ['tools', i, 'number'],
          'duplicateTool',
          `tool T${tool.number} is listed twice`,
        );
      }
      seen.add(tool.number);
      if (p.toolChanger.type === 'auto' && tool.number > p.toolChanger.capacity) {
        crossIssue(
          ctx,
          ['tools', i, 'number'],
          'toolAboveCapacity',
          `tool T${tool.number} exceeds the changer capacity ${p.toolChanger.capacity}`,
        );
      }
    });
    const sets = new Set<string>();
    p.materials.forEach((m, i) => {
      const key = `${m.material}/${m.thickness}`;
      if (sets.has(key)) {
        crossIssue(
          ctx,
          ['materials', i, 'thickness'],
          'duplicateMaterial',
          `${m.material} ${m.thickness} mm is listed twice`,
        );
      }
      sets.add(key);
      if (!seen.has(m.tool)) {
        crossIssue(
          ctx,
          ['materials', i, 'tool'],
          'unknownTool',
          `tool T${m.tool} is not in the tool table`,
        );
      }
      if (m.plungeFeed > m.feed) {
        crossIssue(
          ctx,
          ['materials', i, 'plungeFeed'],
          'plungeAboveFeed',
          'plunge feed must not exceed feed',
        );
      }
      if (m.tabs && m.tabs.height >= m.thickness) {
        crossIssue(
          ctx,
          ['materials', i, 'tabs', 'height'],
          'tabHeightAboveThickness',
          'tab height must be less than the material thickness',
        );
      }
      if (m.rpm < p.spindle.minRpm || m.rpm > p.spindle.maxRpm) {
        crossIssue(
          ctx,
          ['materials', i, 'rpm'],
          'rpmOutsideSpindle',
          'rpm is outside the spindle range',
        );
      }
    });
  });

export type MachineProfile = z.infer<typeof machineProfileSchema>;
/** Profile as a client may send it (fields with defaults optional). */
export type MachineProfileInput = z.input<typeof machineProfileSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type ToolType = z.infer<typeof toolTypeSchema>;
export type MaterialParams = z.infer<typeof materialParamsSchema>;
export type TabParams = z.infer<typeof tabParamsSchema>;
export type MaterialKind = z.infer<typeof materialKindSchema>;
export type OriginCorner = z.infer<typeof originCornerSchema>;

/** A profile validation problem, enough for the UI to build a translated message. */
export interface MachineProfileIssue {
  /** Path like `tools[1].diameter`. */
  path: string;
  /** Zod issue code (`too_small`, `too_big`, `invalid_type`, `invalid_format`, `custom`, ...). */
  code: string;
  /** English message. */
  message: string;
  minimum?: number;
  maximum?: number;
  /** For `too_small`/`too_big`: whether the bound itself is allowed. */
  inclusive?: boolean;
  /** `number`, `string`, `array`, ... (what the bound applies to). */
  origin?: string;
  /** Translation key of a cross-field rule. */
  key?: string;
}

export type ParseMachineProfileResult =
  { ok: true; profile: MachineProfile } | { ok: false; issues: MachineProfileIssue[] };

function pathString(path: readonly PropertyKey[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out === '' ? String(seg) : `.${String(seg)}`;
  }
  return out;
}

function toIssue(issue: z.core.$ZodIssue): MachineProfileIssue {
  const out: MachineProfileIssue = {
    path: pathString(issue.path),
    code: issue.code,
    message: issue.message,
  };
  if (issue.code === 'too_small') {
    out.minimum = Number(issue.minimum);
    out.inclusive = issue.inclusive ?? true;
    out.origin = issue.origin;
  } else if (issue.code === 'too_big') {
    out.maximum = Number(issue.maximum);
    out.inclusive = issue.inclusive ?? true;
    out.origin = issue.origin;
  } else if (issue.code === 'invalid_type') {
    out.origin = issue.expected;
  } else if (issue.code === 'custom') {
    const key = (issue.params as { key?: unknown } | undefined)?.key;
    if (typeof key === 'string') out.key = key;
  }
  return out;
}

/** Validates raw profile JSON. Never throws. */
export function parseMachineProfile(json: unknown): ParseMachineProfileResult {
  const result = machineProfileSchema.safeParse(json);
  if (result.success) return { ok: true, profile: result.data };
  return { ok: false, issues: result.error.issues.map(toIssue) };
}

/**
 * Tab sizes of the material sets below the holding bounds (T302, CTO #12 E3; bounds of T293,
 * D-069). Checked when a profile is saved, not when one is read: a stored set below the bounds
 * stays readable and the toolpath blocks NC for it (`tabSizeProblem`). The issues carry the
 * bound, so the form can say it ("En az 3", "En fazla 17").
 */
export function materialTabIssues(
  profile: Pick<MachineProfile, 'materials'>,
): MachineProfileIssue[] {
  const out: MachineProfileIssue[] = [];
  profile.materials.forEach((m, i) => {
    if (!m.tabs) return;
    const at = (k: string) => `materials[${i}].tabs.${k}`;
    const small = (k: string, minimum: number) =>
      out.push({
        path: at(k),
        code: 'too_small',
        message: `${k} must be at least ${minimum} mm`,
        minimum,
        inclusive: true,
        origin: 'number',
      });
    if (m.tabs.width < TAB_BOUNDS.minWidth) small('width', TAB_BOUNDS.minWidth);
    if (m.tabs.height < TAB_BOUNDS.minHeight) small('height', TAB_BOUNDS.minHeight);
    else if (m.tabs.height > maxTabHeight(m.thickness)) {
      const maximum = maxTabHeight(m.thickness);
      out.push({
        path: at('height'),
        code: 'too_big',
        message: `height must be at most ${maximum} mm (thickness minus ${TAB_BOUNDS.belowThickness} mm)`,
        maximum,
        inclusive: true,
        origin: 'number',
      });
    }
  });
  return out;
}

/** `parseMachineProfile` plus the rules that only apply to a profile being saved (T302). */
export function parseMachineProfileForSave(json: unknown): ParseMachineProfileResult {
  const parsed = parseMachineProfile(json);
  if (!parsed.ok) return parsed;
  const issues = materialTabIssues(parsed.profile);
  return issues.length > 0 ? { ok: false, issues } : parsed;
}

/** Tool by number, or `undefined`. */
export function findTool(profile: Pick<MachineProfile, 'tools'>, number: number): Tool | undefined {
  return profile.tools.find((t) => t.number === number);
}
