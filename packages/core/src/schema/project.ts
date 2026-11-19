/**
 * Project JSON schema v2 (spec §9.2; v2 = free-angle grain, D-034). All lengths are millimetres (spec §6.1).
 * Validation only: no I/O, clock or randomness. Messages are English; the UI translates them.
 */
import { z } from 'zod';
import { normalizeRotation } from '../geometry/grain';

/** The schema version this build writes and reads natively. */
export const LATEST_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Any finite coordinate in mm (may be negative). */
const coord = z.number({ error: 'must be a finite number (mm)' });

/** A strictly positive length in mm. */
const positiveMm = z
  .number({ error: 'must be a number (mm)' })
  .positive({ error: 'must be a positive length in mm' });

/** A length in mm that may be zero. */
const nonNegativeMm = z
  .number({ error: 'must be a number (mm)' })
  .nonnegative({ error: 'must be zero or a positive length in mm' });

const nonEmptyId = z.string({ error: 'must be a string' }).min(1, { error: 'must not be empty' });

const positiveInt = z
  .number({ error: 'must be a number' })
  .int({ error: 'must be an integer' })
  .min(1, { error: 'must be an integer >= 1' });

/**
 * A grain angle in degrees, [0, 180) (D-034): grain is an undirected line, so 30° and 210° are the
 * same grain and are stored as 30.
 */
export const grainAngleSchema = z
  .number({ error: 'grain angle must be a number (degrees)' })
  .min(0, { error: 'grain angle must be >= 0 and < 180 degrees' })
  .lt(180, { error: 'grain angle must be >= 0 and < 180 degrees' });

/** Placement rotation, counter-clockwise degrees in [0, 360) with at most 3 decimals (D-034). */
export const rotationSchema = z
  .number({ error: 'rot must be a number (degrees)' })
  .min(0, { error: 'rot must be >= 0 and < 360 degrees' })
  .lt(360, { error: 'rot must be >= 0 and < 360 degrees' })
  .refine((r) => normalizeRotation(r) === r, { error: 'rot must have at most 3 decimals' });

// ---------------------------------------------------------------------------
// Geometry (spec §6.1): bulge polyline, closed implicitly
// ---------------------------------------------------------------------------

/** A polyline vertex; `bulge` = tan(θ/4) of the arc to the next vertex (0 = straight line). */
export const vertexSchema = z.strictObject({
  x: coord,
  y: coord,
  bulge: z.number({ error: 'bulge must be a finite number' }),
});

/**
 * A closed contour as a vertex list (the last vertex connects back to the first).
 * Two vertices are enough only when at least one segment is an arc (e.g. a full circle).
 */
export const contourSchema = z
  .array(vertexSchema)
  .min(2, { error: 'a contour needs at least 2 vertices' })
  .refine((vs) => vs.length >= 3 || vs.some((v) => v.bulge !== 0), {
    error: 'a contour with 2 vertices must contain an arc (non-zero bulge)',
  });

// ---------------------------------------------------------------------------
// Holes (spec §4.5)
// ---------------------------------------------------------------------------

const holeBase = {
  /** Unique within the part (commands address holes by id). */
  id: nonEmptyId,
  /** Diameter in mm (for a groove: the centreline diameter the tool centre follows). */
  d: positiveMm,
  /** Centre relative to the part's local origin (bottom-left), mm. */
  cx: coord,
  cy: coord,
  /** Tool number in the machine profile. */
  tool: positiveInt,
};

/** Blind pocket: the whole diameter cleared to `depth` (e.g. a 35 mm hinge cup). */
export const pocketHoleSchema = z.strictObject({
  type: z.literal('pocket'),
  ...holeBase,
  depth: positiveMm,
});

/** Through hole: the whole diameter cleared through the material; depth comes from stock + machine. */
export const throughHoleSchema = z.strictObject({
  type: z.literal('through'),
  ...holeBase,
});

/** Ring groove: the tool centre follows the circle of diameter `d` (centreline). */
export const grooveHoleSchema = z
  .strictObject({
    type: z.literal('groove'),
    ...holeBase,
    depth: positiveMm,
    grooveWidth: positiveMm,
  })
  .refine((g) => g.grooveWidth < g.d, {
    error: 'groove width must be smaller than the centreline diameter d',
    path: ['grooveWidth'],
  });

export const holeSchema = z.discriminatedUnion(
  'type',
  [pocketHoleSchema, throughHoleSchema, grooveHoleSchema],
  { error: 'unknown hole type; expected "pocket", "through" or "groove"' },
);

// ---------------------------------------------------------------------------
// Parts (spec §4.1, §4.3, §4.7, §4.8)
// ---------------------------------------------------------------------------

/** Edge band thickness per edge in mm; 0 = no band. */
export const edgeBandSchema = z.strictObject({
  top: nonNegativeMm,
  right: nonNegativeMm,
  bottom: nonNegativeMm,
  left: nonNegativeMm,
});

// ---------------------------------------------------------------------------
// Templates (T147, spec §4.7): a parametric group of holes, inner contours and lines
// ---------------------------------------------------------------------------

/**
 * Operation of a template contour (T147). Same shape as the per-contour operation of T142
 * (`inside` | `online` with depth | `none`); kept separate so templates do not depend on it.
 */
export const templateContourOpSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('inside') }),
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('online'), depth: positiveMm }),
  ],
  { error: 'operation must be "inside", "online" (with depth) or "none"' },
);

/**
 * Geometry of a template in its own frame (T147): local +x points into the part away from the
 * reference edge, local +y runs along that edge, the origin is the reference point (the edge
 * distance is measured to it). Holes keep their own ids (unique within the template).
 */
export const templateGeometrySchema = z
  .strictObject({
    holes: z.array(holeSchema).max(200, { error: 'at most 200 holes' }),
    inners: z
      .array(z.strictObject({ contour: contourSchema, op: templateContourOpSchema.optional() }))
      .max(50, { error: 'at most 50 inner contours' }),
    lines: z
      .array(
        z.strictObject({
          vertices: z.array(vertexSchema).min(2, { error: 'a line needs at least 2 vertices' }),
          op: templateContourOpSchema,
        }),
      )
      .max(200, { error: 'at most 200 lines' })
      .optional(),
  })
  .superRefine((g, ctx) => {
    const ids = new Set<string>();
    g.holes.forEach((h, i) => {
      if (ids.has(h.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate hole id "${h.id}"`,
          path: ['holes', i, 'id'],
        });
      }
      ids.add(h.id);
    });
    if (g.holes.length + g.inners.length + (g.lines?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'a template needs at least one hole, contour or line',
        path: [],
      });
    }
  });

/**
 * Template parameters (spec §4.7 "çap, kenardan mesafe, adet, aralık"): `count` copies of the
 * group, `spacing` mm apart along local +y and centred on the origin; `edgeDistance` = reference
 * edge → origin; `d` = diameter per template hole id (absent = the hole's own diameter).
 */
export const templateParamsSchema = z.strictObject({
  count: positiveInt.max(50, { error: 'at most 50 copies' }),
  spacing: nonNegativeMm,
  edgeDistance: nonNegativeMm,
  d: z.record(z.string(), positiveMm),
});

/** A part edge a template is anchored to (T148). */
export const templateEdgeSchema = z.enum(['left', 'right', 'bottom', 'top'], {
  error: 'edge must be "left", "right", "bottom" or "top"',
});

/**
 * Where a template instance sits on its part (T148): the origin (part frame, mm), the rotation
 * (CCW degrees), `mirror` = flipped along the edge (local y → −y, applied before the rotation;
 * left / right door) and the anchored edge (`null` = free; anchored = the origin keeps
 * `edgeDistance` from that edge).
 */
export const templatePlacementSchema = z.strictObject({
  x: coord,
  y: coord,
  rot: rotationSchema,
  mirror: z.boolean({ error: 'must be true or false' }),
  edge: templateEdgeSchema.nullable(),
});

/**
 * A copy of a template as used in the project (spec §4.7 "Kopya ve sürüm"): the template's
 * geometry and default params of `version` are copied, so a later template edit never changes the
 * project until the user accepts the update (T149).
 */
export const templateRefSchema = z.strictObject({
  /** Unique within the part; prefixes the ids of the holes it creates. */
  instanceId: nonEmptyId.max(40, { error: 'at most 40 characters' }),
  templateId: nonEmptyId,
  version: positiveInt,
  name: z.string({ error: 'must be a string' }).max(80, { error: 'at most 80 characters' }),
  geometry: templateGeometrySchema,
  /** The template's params of `version` (the base the update conflict check compares with). */
  defaults: templateParamsSchema,
  /** Current values (defaults + the user's changes). */
  params: templateParamsSchema,
  /** Names of the params the user changed by hand (`count`, `spacing`, `edgeDistance`, `d.<hole id>`). */
  overrides: z.array(z.string()),
  placement: templatePlacementSchema,
});

/**
 * A linear dimension on the drawing (T133, spec §4.4 "ölçü"): the aligned distance between two
 * points in the part frame. A non-cut annotation: nesting, toolpath and export ignore it.
 */
export const dimensionLineSchema = z.strictObject({
  id: nonEmptyId,
  a: z.strictObject({ x: coord, y: coord }),
  b: z.strictObject({ x: coord, y: coord }),
});

// ---------------------------------------------------------------------------
// Per-contour operations (T142, spec §4.6, §6.3)
// ---------------------------------------------------------------------------

/**
 * What the machine does on one contour (T142). `outside`: through cut with the tool outside the
 * line (the default of an outline). `inside`: through cut with the tool inside the line (the
 * default of an inner contour). `online`: the tool centre follows the line at `depth` mm
 * (engraving; open lines allowed; never a through cut: depth < thickness). `none`: not cut.
 * Allowed kinds per contour: outline outside | online | none; inner inside | online | none;
 * open line online | none (`allowedOperations`). DXF layer mapping (T145) writes this same value.
 */
export const contourOperationSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('outside') }),
    z.strictObject({ kind: z.literal('inside') }),
    z.strictObject({ kind: z.literal('none') }),
    z.strictObject({ kind: z.literal('online'), depth: positiveMm }),
  ],
  { error: 'operation must be "outside", "inside", "online" (with depth) or "none"' },
);

/** An open polyline in the part frame (T142); `bulge` on the last vertex is ignored. */
export const openLineSchema = z.strictObject({
  vertices: z.array(vertexSchema).min(2, { error: 'a line needs at least 2 vertices' }),
  op: contourOperationSchema,
});

/**
 * Operations that differ from the defaults (T142). Absent = outline `outside`, every inner
 * `inside`. `inners[k]` belongs to `inners[k]` of the part; `null` or missing = the default.
 */
export const partOperationsSchema = z.strictObject({
  outline: contourOperationSchema.optional(),
  inners: z.array(contourOperationSchema.nullable()).optional(),
});

/** A part's grain (D-034); `angle` is in the part's own frame, [0, 180). */
export const partGrainSchema = z.strictObject({
  mode: z.enum(['free', 'fixed'], { error: 'grain mode must be "free" or "fixed"' }),
  angle: grainAngleSchema,
});

const partBase = {
  id: nonEmptyId,
  name: z.string({ error: 'must be a string' }),
  qty: positiveInt,
  /** Free text for the workshop (material, colour, customer; T118). Absent = none. */
  note: z
    .string({ error: 'must be a string' })
    .max(200, { error: 'at most 200 characters' })
    .optional(),
  /**
   * Group label (T122, T123), e.g. the cabinet a part came from. Only a label (D-041): editable,
   * removable, never a lock and never a link back to a generator. Absent = no group.
   */
  group: z
    .string({ error: 'must be a string' })
    .trim()
    .min(1, { error: 'must not be empty' })
    .max(60, { error: 'at most 60 characters' })
    .optional(),
  /**
   * Grain of the piece (D-034): `fixed` = the grain line at `angle` (part frame) must lie along the
   * sheet grain after placement; `free` = no grain rule (the angle is kept for display).
   */
  grain: partGrainSchema,
  /** Inner contours (windows, cut-outs), stored CW (spec §6.1). */
  inners: z.array(contourSchema),
  holes: z.array(holeSchema),
  /** Per-contour operations (T142); absent = the defaults (see `partOperationsSchema`). */
  ops: partOperationsSchema.optional(),
  /** Open lines (T142), e.g. engraving from a DXF layer (T145); absent = none. */
  lines: z.array(openLineSchema).max(500, { error: 'at most 500 lines' }).optional(),
  edgeBand: edgeBandSchema,
  templates: z.array(templateRefSchema),
  /** Linear dimensions in the part frame (T133); annotations only, never cut. Absent = none. */
  dims: z.array(dimensionLineSchema).max(200, { error: 'at most 200 dimensions' }).optional(),
  /**
   * Position of the part's local origin on the drawing board, mm (T124, D-037). Editor-only
   * placement: nesting, toolpath and export ignore it. Absent = the board arranges the part.
   */
  draw: z.strictObject({ x: coord, y: coord }).optional(),
};

/** Parametric rectangle: `params` is the source; `outline` is derived (see deriveOutline). */
export const rectParamsSchema = z
  .strictObject({
    w: positiveMm,
    h: positiveMm,
    /** Corner radius in mm; 0 = sharp corners. */
    r: nonNegativeMm,
  })
  .refine((p) => p.r <= Math.min(p.w, p.h) / 2, {
    error: 'corner radius must not exceed half of the shorter side',
    path: ['r'],
  });

export const rectPartSchema = z.strictObject({
  ...partBase,
  kind: z.literal('rect'),
  params: rectParamsSchema,
  /** Optional cached outline; ignored as a source. Use deriveOutline(part). */
  outline: z.array(vertexSchema).optional(),
});

/** Freeform part: `outline` is the source, stored CCW (spec §6.1). */
export const freeformPartSchema = z.strictObject({
  ...partBase,
  kind: z.literal('freeform'),
  outline: contourSchema,
});

export const partSchema = z.discriminatedUnion('kind', [rectPartSchema, freeformPartSchema], {
  error: 'unknown part kind; expected "rect" or "freeform"',
});

// ---------------------------------------------------------------------------
// Project sections
// ---------------------------------------------------------------------------

export const machineRefSchema = z.strictObject({
  machineId: nonEmptyId,
  profileVersion: positiveInt,
});

export const stockSchema = z.strictObject({
  material: nonEmptyId,
  /**
   * Company library entry the stock was picked from (T121); display only: `material` (the kind)
   * and the sizes below stay the source. Absent = typed by hand or picked before T121.
   */
  libraryId: nonEmptyId.max(64, { error: 'at most 64 characters' }).optional(),
  thickness: positiveMm,
  sheet: z.strictObject({
    width: positiveMm,
    height: positiveMm,
    /** Sheet grain angle in degrees [0, 180) (0 = along X); `null` = the sheet has no grain. */
    grain: grainAngleSchema.nullable(),
  }),
  useOffcuts: z.boolean({ error: 'must be true or false' }),
});

/** Nesting goal (spec §6.2). */
export const nestingModeSchema = z.enum(['minWaste', 'fastest', 'minToolChanges'], {
  error: 'nesting mode must be "minWaste", "fastest" or "minToolChanges"',
});

/**
 * Rotation policy of parts without a grain rule (T163, D-055): `free` = quarter turns (the
 * default), `none` = only 0°/180° (the drawn orientation). The grain rule always wins. T166 may
 * add step values (e.g. `step45`) to this enum.
 */
export const nestingRotationSchema = z.enum(['free', 'none'], {
  error: 'rotation must be "free" or "none"',
});

export const nestingSchema = z.strictObject({
  mode: nestingModeSchema,
  /** Absent = `free` (projects before T163 need no migration). */
  rotation: nestingRotationSchema.optional(),
  /** Gap between parts, mm. */
  gap: nonNegativeMm,
  /** Sheet edge margin, mm. */
  margin: nonNegativeMm,
});

export const placementSchema = z.strictObject({
  partId: nonEmptyId,
  /** Which copy of the part (0 ≤ index < qty). */
  index: z
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .nonnegative({ error: 'must be an integer >= 0' }),
  x: coord,
  y: coord,
  /** Counter-clockwise rotation, degrees [0, 360) with 3 decimals (D-034). */
  rot: rotationSchema,
  locked: z.boolean({ error: 'must be true or false' }),
});

/** Derived but stored, so manually locked placements survive (spec §9.2). */
export const layoutSchema = z.strictObject({
  sheets: z.array(z.strictObject({ placements: z.array(placementSchema) })),
});

export const cuttingSchema = z.strictObject({
  /**
   * Tabs (§6.3, D-022). `auto: true` = tabs on every part, placed automatically; `false` = tabs only
   * on small parts (small-part safety, always on). count/width/height override the material
   * parameter set's tab defaults (optional; added in T015, older projects stay valid).
   */
  tabs: z.strictObject({
    auto: z.boolean({ error: 'must be true or false' }),
    count: z
      .number({ error: 'must be a number' })
      .int({ error: 'must be an integer' })
      .min(1, { error: 'must be at least 1' })
      .max(20, { error: 'must be at most 20' })
      .optional(),
    width: z.number({ error: 'must be a number' }).positive({ error: 'must be > 0' }).optional(),
    height: z.number({ error: 'must be a number' }).positive({ error: 'must be > 0' }).optional(),
  }),
  /**
   * Thin skin (T143, §6.3 "son pasoda ince tabaka bırak"): present = small parts are held by a
   * skin of `thickness` mm instead of tabs, removed by a cleanup pass at the end of each sheet.
   * Absent = tabs (the default). Tabs and skin are alternatives per project.
   */
  skin: z
    .strictObject({
      thickness: z.number({ error: 'must be a number' }).positive({ error: 'must be > 0' }),
    })
    .optional(),
  leadIn: z.enum(['arc', 'line'], { error: 'leadIn must be "arc" or "line"' }),
  direction: z.enum(['climb', 'conventional'], {
    error: 'direction must be "climb" or "conventional"',
  }),
});

/**
 * How entered part sizes are read (spec §4.8). `cut`: sizes are cut sizes. `finished`: sizes are
 * finished sizes and the edge-band thickness is deducted from the cut size (applied later, not here).
 */
export const dimensionModeSchema = z.enum(['cut', 'finished'], {
  error: 'dimensionMode must be "cut" or "finished"',
});

/** Project-level settings; omitted settings default to `{ dimensionMode: 'cut' }`. */
export const settingsSchema = z
  .strictObject({ dimensionMode: dimensionModeSchema.default('cut') })
  .default({ dimensionMode: 'cut' });

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const projectSchema = z
  .strictObject({
    schemaVersion: z.literal(LATEST_SCHEMA_VERSION, {
      error: `schemaVersion must be ${LATEST_SCHEMA_VERSION}`,
    }),
    machine: machineRefSchema,
    stock: stockSchema,
    parts: z.array(partSchema),
    nesting: nestingSchema,
    layout: layoutSchema,
    cutting: cuttingSchema,
    settings: settingsSchema,
  })
  .superRefine((project, ctx) => {
    // Cross-references: unique part ids and hole ids; placements point at existing part copies.
    const qtyById = new Map<string, number>();
    project.parts.forEach((part, i) => {
      const holeIds = new Set<string>();
      part.holes.forEach((hole, h) => {
        if (holeIds.has(hole.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate hole id "${hole.id}" in part "${part.id}"`,
            path: ['parts', i, 'holes', h, 'id'],
          });
        }
        holeIds.add(hole.id);
      });
      // Template instances (T148) are addressed by instance id within the part.
      const instanceIds = new Set<string>();
      part.templates.forEach((ref, t) => {
        if (instanceIds.has(ref.instanceId)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate template instance id "${ref.instanceId}" in part "${part.id}"`,
            path: ['parts', i, 'templates', t, 'instanceId'],
          });
        }
        instanceIds.add(ref.instanceId);
      });
      if (qtyById.has(part.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate part id "${part.id}"`,
          path: ['parts', i, 'id'],
        });
      } else {
        qtyById.set(part.id, part.qty);
      }
    });
    const seen = new Set<string>();
    project.layout.sheets.forEach((sheet, s) => {
      sheet.placements.forEach((pl, p) => {
        const path = ['layout', 'sheets', s, 'placements', p];
        const qty = qtyById.get(pl.partId);
        if (qty === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `placement refers to unknown part "${pl.partId}"`,
            path: [...path, 'partId'],
          });
          return;
        }
        if (pl.index >= qty) {
          ctx.addIssue({
            code: 'custom',
            message: `placement index ${pl.index} is out of range for part "${pl.partId}" (qty ${qty})`,
            path: [...path, 'index'],
          });
        }
        const key = `${pl.partId}#${pl.index}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: 'custom',
            message: `copy ${pl.index} of part "${pl.partId}" is placed more than once`,
            path,
          });
        }
        seen.add(key);
      });
    });
  });

export type Vertex = z.infer<typeof vertexSchema>;
export type Contour = z.infer<typeof contourSchema>;
export type PocketHole = z.infer<typeof pocketHoleSchema>;
export type ThroughHole = z.infer<typeof throughHoleSchema>;
export type GrooveHole = z.infer<typeof grooveHoleSchema>;
export type Hole = z.infer<typeof holeSchema>;
export type EdgeBand = z.infer<typeof edgeBandSchema>;
export type TemplateRef = z.infer<typeof templateRefSchema>;
export type TemplateGeometry = z.infer<typeof templateGeometrySchema>;
export type TemplateParams = z.infer<typeof templateParamsSchema>;
export type TemplatePlacement = z.infer<typeof templatePlacementSchema>;
export type TemplateEdge = z.infer<typeof templateEdgeSchema>;
export type TemplateContourOp = z.infer<typeof templateContourOpSchema>;
export type DimensionLine = z.infer<typeof dimensionLineSchema>;
export type ContourOperation = z.infer<typeof contourOperationSchema>;
export type ContourOperationKind = ContourOperation['kind'];
export type OpenLine = z.infer<typeof openLineSchema>;
export type PartOperations = z.infer<typeof partOperationsSchema>;
export type RectParams = z.infer<typeof rectParamsSchema>;
export type RectPart = z.infer<typeof rectPartSchema>;
export type FreeformPart = z.infer<typeof freeformPartSchema>;
export type Part = z.infer<typeof partSchema>;
export type PartGrain = z.infer<typeof partGrainSchema>;
export type MachineRef = z.infer<typeof machineRefSchema>;
export type Stock = z.infer<typeof stockSchema>;
export type NestingMode = z.infer<typeof nestingModeSchema>;
export type NestingRotation = z.infer<typeof nestingRotationSchema>;
export type Nesting = z.infer<typeof nestingSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type Cutting = z.infer<typeof cuttingSchema>;
export type DimensionMode = z.infer<typeof dimensionModeSchema>;
export type Settings = z.infer<typeof settingsSchema>;
/** A validated project (defaults applied). */
export type Project = z.infer<typeof projectSchema>;
/** Project JSON as accepted on input (before defaults are applied). */
export type ProjectInput = z.input<typeof projectSchema>;
