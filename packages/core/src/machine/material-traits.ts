/**
 * Material behaviour table (M-Metal foundation, T341, D-118 / D-130; spec §3.6 "Malzeme
 * davranışı"; design `docs/metal/metal-analizi.md` §4): one row of plain data per material kind.
 * Screens, toolpath, validation and the independent G-code check read a kind's behaviour from
 * here instead of branching on the kind ("no `if metal` branches").
 *
 * The six existing kinds carry exactly today's module constants (`TAB_DEFAULTS`, `TAB_BOUNDS`,
 * `SKIN_BOUNDS`, `OPERATION_TOOL_TYPES`, grain yes/no, the 3D look); a test compares them with the
 * live constants and a snapshot locks the rows. Later batches add metal rows and fields (coolant,
 * entry, step-down, chip load, finish, …); every new field must give today's result for these six.
 *
 * Pure data without zod (like `material-kinds.ts`), so UI code that only reads traits stays light.
 */
import { MATERIAL_KIND_IDS, type MaterialKind } from './material-kinds';
import type { ToolType } from './profile';

/** Family of a kind: shared defaults, the picker group and (later) the verification family. */
export type MaterialFamily = 'woodBoard' | 'plastic' | 'composite' | 'nonFerrous';

/** Every family in picker order. */
export const MATERIAL_FAMILIES: readonly MaterialFamily[] = [
  'woodBoard',
  'plastic',
  'composite',
  'nonFerrous',
];

/** Operations that pick a cutting tool (mirrors `OPERATION_TOOL_KINDS` in `toolpath/op-tools`). */
export type TraitsOperation = 'outer' | 'inner' | 'pocket' | 'hole';

export interface MaterialTraits {
  family: MaterialFamily;
  /** `flagged`: shown only behind a feature flag (none today; D-130 shows ACM and aluminium). */
  release: 'released' | 'flagged';
  /**
   * Whether NC may leave the app for this kind (D-130): `released` = as today; `unverified` = NC with
   * the header line `DOGRULANMAMIS MALZEME: <name>` and a required export checklist item;
   * `blocked` = no NC download (DXF / PDF / labels still work) until the tier's own tasks land.
   */
  nc: 'released' | 'unverified' | 'blocked';
  /** Name used in the NC header line of an `unverified` kind (ASCII, upper case). */
  ncName: string;
  direction: {
    /**
     * `none`: the material has no direction (no grain field anywhere); `axial`: 30° = 210°
     * (wood grain, aluminium rolling direction); `directed`: 30° ≠ 210° (ACM film arrow, T347).
     */
    kind: 'none' | 'axial' | 'directed';
    /** Which wording the screens use: "Damar yönü" / "Yüzey yönü" / "Film oku yönü". */
    label: 'grain' | 'surface' | 'film';
    /** Whether a new sheet / offcut of this kind starts with a direction (0°). */
    defaultOn: boolean;
  };
  /**
   * T348 (§3.6 "İşlenen yüz"): the face a new stock of this kind is machined from. ACM is cut from
   * the back (parts mirrored); every other kind from the front (today).
   */
  machinedFace: 'front' | 'back';
  /** Tool types each operation may cut with. */
  toolTypes: Readonly<Record<TraitsOperation, readonly ToolType[]>>;
  tabs: {
    defaults: {
      count: number;
      /** Bridge width, mm. */
      width: number;
      /** Default height (material left) at most, mm: height = min(this, t / 2). */
      materialLeft: number;
      /** Fewest tabs on an auto-tabbed small part. */
      smallPartMinCount: number;
    };
    bounds: {
      minWidth: number;
      /** Material beyond the tab's kerf that no other cut removes, mm. */
      minAnchor: number;
      minHeight: number;
      /** Height at most thickness minus this, mm. */
      belowThickness: number;
    };
  };
  skin: {
    min: number;
    /** Skin at most thickness minus this, mm. */
    belowThickness: number;
    /** T349: absolute ceiling of the skin, mm (aluminium 0,3; absent = only `belowThickness`). */
    max?: number;
    /**
     * T349 (analysis §4.2 "İnce tabaka"): whether step 1 offers the thin skin. ACM: no (its lower
     * aluminium face is already thin); a skin carried over from another kind still shows, so it can
     * be turned off.
     */
    offered: boolean;
  };
  /** T349 (§4.8, analysis §5.2): edge band columns, band deduction and the band on labels. */
  edgeBand: boolean;
  /** T349: "Dolap ekle" (cabinet generator). */
  cabinet: boolean;
  /**
   * T349 (§7.1 "Metal kesim"): the kind may only be cut on a machine that declares metal cutting
   * (`profile.metal.enabled`); otherwise `MATERIAL_NOT_ALLOWED_ON_MACHINE`.
   */
  needsMetalMachine: boolean;
  /** T351 (analysis §4.2 "Soğutma"): the set's coolant field is shown unless `none`. */
  coolant: 'none' | 'recommended' | 'required';
  /**
   * T351 (analysis §4.2 "Giriş", §4.5): `straightPlunge` = a straight plunge is allowed (today);
   * otherwise the set's ramp angle field is shown with this default and ceiling, degrees.
   */
  entry: { straightPlunge: boolean; rampDeg: { default: number; max: number } | null };
  /**
   * T351 (analysis §4.2 "Paso derinliği tavanı"): the step-down ceiling as a share of the tool
   * diameter (scaled by the machine rigidity, `stepDownCeiling`); `null` = no ceiling (today).
   */
  stepDown: { maxPerDiameter: number | null };
  /**
   * T351 (analysis §4.2 / §4.5 "Talaş yükü"): chip load band per tool diameter, mm per tooth. A
   * band applies from its `minDiameter` up to the next one. `warn`: shown and marked; `limit`: a
   * set outside the band cannot be saved. `null`: no band and no chip load cell (today's kinds).
   */
  chipLoad: {
    enforce: 'warn' | 'limit';
    bands: readonly { minDiameter: number; min: number; max: number }[];
  } | null;
  /** T351 (analysis §4.2 "Finiş pasosu"): default finish allowance, mm; `null` = no finish field. */
  finish: { defaultAllowance: number | null };
  /** Small parts (auto tabs / skin): outline area below `area` mm² or a side below `minSide` mm. */
  smallPart: { area: number; minSide: number };
  /** Sheet size presets of step 1 (short × long side, mm). */
  sheetPresets: readonly { a: number; b: number }[];
  /** Thickness presets of step 1, mm (empty: the profile's thicknesses only, as today). */
  thicknessPresets: readonly number[];
  look: {
    /** Token custom property of the base colour (`packages/ui/src/tokens.css`). */
    token: string;
    /** 3D surface roughness (matte everywhere). */
    roughness: number;
    /** Visible grain stripes in the procedural texture. */
    stripes: boolean;
    /** Procedural texture noise amplitude. */
    noise: number;
    /** 3D metalness (0 = today's matte boards; aluminium is metallic). */
    metalness: number;
  };
}

const WOOD_TOOLS: MaterialTraits['toolTypes'] = {
  outer: ['flatEndMill', 'compression'],
  inner: ['flatEndMill', 'compression'],
  pocket: ['flatEndMill', 'compression'],
  hole: ['drill', 'flatEndMill'],
};

/** ACM and aluminium (§4.2): flat end mills only (no compression, no ball); holes as today. */
const METAL_TOOLS: MaterialTraits['toolTypes'] = {
  outer: ['flatEndMill'],
  inner: ['flatEndMill'],
  pocket: ['flatEndMill'],
  hole: ['drill', 'flatEndMill'],
};

const TABS: MaterialTraits['tabs'] = {
  defaults: { count: 4, width: 10, materialLeft: 3, smallPartMinCount: 2 },
  bounds: { minWidth: 3, minAnchor: 3, minHeight: 1, belowThickness: 1 },
};

const SKIN: MaterialTraits['skin'] = { min: 0.2, belowThickness: 1, offered: true };

const SMALL_PART: MaterialTraits['smallPart'] = { area: 50_000, minSide: 100 };

const SHEET_PRESETS: MaterialTraits['sheetPresets'] = [
  { a: 1220, b: 2440 },
  { a: 2100, b: 2800 },
  { a: 2070, b: 2800 },
];

/** Shared part of the two families today: everything but the family, direction and look. */
const BOARD = {
  release: 'released',
  nc: 'released',
  ncName: '',
  machinedFace: 'front',
  toolTypes: WOOD_TOOLS,
  tabs: TABS,
  skin: SKIN,
  smallPart: SMALL_PART,
  sheetPresets: SHEET_PRESETS,
  thicknessPresets: [],
  edgeBand: true,
  cabinet: true,
  needsMetalMachine: false,
  coolant: 'none',
  entry: { straightPlunge: true, rampDeg: null },
  stepDown: { maxPerDiameter: null },
  chipLoad: null,
  finish: { defaultAllowance: null },
} as const satisfies Partial<MaterialTraits>;

/**
 * T349 / T351: what ACM and aluminium share (analysis §4.2, §4.5): no edge band, no cabinet, ramp
 * entry 2° (at most 5°). Every number "doğrulanacak" until the machine tests T357 / T369.
 */
const METAL_COMMON = {
  edgeBand: false,
  cabinet: false,
  entry: { straightPlunge: false, rampDeg: { default: 2, max: 5 } },
} as const satisfies Partial<MaterialTraits>;

const GRAIN: MaterialTraits['direction'] = { kind: 'axial', label: 'grain', defaultOn: true };
const NO_DIRECTION: MaterialTraits['direction'] = {
  kind: 'none',
  label: 'grain',
  defaultOn: false,
};

/** Texture noise: MDF a fine fibre noise, striped woods a little, flat tones almost none. */
const NOISE = { fibre: 0.045, stripes: 0.02, flat: 0.008 } as const;

export const MATERIAL_TRAITS: Readonly<Record<MaterialKind, MaterialTraits>> = {
  mdf: {
    ...BOARD,
    family: 'woodBoard',
    direction: GRAIN,
    look: {
      token: '--color-mat-mdf',
      roughness: 0.92,
      stripes: false,
      noise: NOISE.fibre,
      metalness: 0,
    },
  },
  plywood: {
    ...BOARD,
    family: 'woodBoard',
    direction: GRAIN,
    look: {
      token: '--color-mat-plywood',
      roughness: 0.92,
      stripes: true,
      noise: NOISE.stripes,
      metalness: 0,
    },
  },
  melamine: {
    ...BOARD,
    family: 'woodBoard',
    direction: GRAIN,
    look: {
      token: '--color-mat-melamine',
      roughness: 0.92,
      stripes: false,
      noise: NOISE.flat,
      metalness: 0,
    },
  },
  solidWood: {
    ...BOARD,
    family: 'woodBoard',
    direction: GRAIN,
    look: {
      token: '--color-mat-solid-wood',
      roughness: 0.92,
      stripes: true,
      noise: NOISE.stripes,
      metalness: 0,
    },
  },
  acrylic: {
    ...BOARD,
    family: 'plastic',
    direction: NO_DIRECTION,
    look: {
      token: '--color-mat-acrylic',
      roughness: 0.55,
      stripes: false,
      noise: NOISE.flat,
      metalness: 0,
    },
  },
  pvc: {
    ...BOARD,
    family: 'plastic',
    direction: NO_DIRECTION,
    look: {
      token: '--color-mat-pvc',
      roughness: 0.7,
      stripes: false,
      noise: NOISE.flat,
      metalness: 0,
    },
  },
  // T346 (D-130): starting values from analysis §4.2 / §4.5 (conservative value wins; every
  // number below is "doğrulanacak" until the owner's machine tests T357 / T369).
  acm: {
    ...BOARD,
    family: 'composite',
    nc: 'unverified',
    ncName: 'ACM',
    machinedFace: 'back',
    toolTypes: METAL_TOOLS,
    direction: { kind: 'directed', label: 'film', defaultOn: false },
    tabs: {
      defaults: { count: 4, width: 6, materialLeft: 1, smallPartMinCount: 2 },
      bounds: { minWidth: 3, minAnchor: 3, minHeight: 0.5, belowThickness: 0.5 },
    },
    ...METAL_COMMON,
    // §4.2 "İnce tabaka: gizli"; bounds like the tab heights (0,5 … t − 0,5) for a carried-over skin.
    skin: { min: 0.5, belowThickness: 0.5, offered: false },
    coolant: 'recommended',
    // Research §c acm: warning floor = cl_min × 0,8 (Ø3 0,05, Ø6 0,076, Ø8 0,10); ceiling the
    // Alucobond 5 m/min at 24 000 rpm single flute (≈ 0,21).
    chipLoad: {
      enforce: 'warn',
      bands: [
        { minDiameter: 0, min: 0.04, max: 0.21 },
        { minDiameter: 6, min: 0.06, max: 0.21 },
        { minDiameter: 8, min: 0.08, max: 0.21 },
      ],
    },
    // 1250 × 2440 first: it fits nearly every router table, so a switch to ACM never lands on a
    // sheet the machine cannot hold (B68 tester; the 3200 lengths exceed a 3050 table).
    sheetPresets: [
      { a: 1250, b: 2440 },
      { a: 1250, b: 3200 },
      { a: 1500, b: 3200 },
    ],
    thicknessPresets: [3, 4, 6],
    look: {
      token: '--color-mat-acm',
      roughness: 0.6,
      stripes: false,
      noise: NOISE.flat,
      metalness: 0,
    },
  },
  aluminium: {
    ...BOARD,
    family: 'nonFerrous',
    nc: 'blocked',
    ncName: 'ALUMINYUM',
    toolTypes: METAL_TOOLS,
    direction: { kind: 'axial', label: 'surface', defaultOn: false },
    tabs: {
      defaults: { count: 4, width: 5, materialLeft: 0.8, smallPartMinCount: 2 },
      bounds: { minWidth: 3, minAnchor: 3, minHeight: 0.3, belowThickness: 0.3 },
    },
    ...METAL_COMMON,
    // §4.2 / §4.5: skin 0,1 … 0,3 mm (the tab's alternative).
    skin: { min: 0.1, belowThickness: 0.3, max: 0.3, offered: true },
    needsMetalMachine: true,
    coolant: 'required',
    // ≤ 0,5 × Ø (light machine 0,25 × Ø via the rigidity, `stepDownCeiling`).
    stepDown: { maxPerDiameter: 0.5 },
    // §4.5: Ø < 3 0,005–0,02; Ø 3–6 0,02–0,05; Ø ≥ 6 0,04–0,10 mm/tooth.
    chipLoad: {
      enforce: 'limit',
      bands: [
        { minDiameter: 0, min: 0.005, max: 0.02 },
        { minDiameter: 3, min: 0.02, max: 0.05 },
        { minDiameter: 6, min: 0.04, max: 0.1 },
      ],
    },
    finish: { defaultAllowance: 0.2 },
    sheetPresets: [
      { a: 1000, b: 2000 },
      { a: 1250, b: 2500 },
      { a: 1500, b: 3000 },
    ],
    thicknessPresets: [1, 1.5, 2, 3, 4, 5, 6, 8, 10],
    look: {
      token: '--color-mat-aluminium',
      roughness: 0.4,
      stripes: false,
      noise: NOISE.flat,
      metalness: 0.6,
    },
  },
};

/**
 * Traits of an unknown kind (`materialKindOf` → null): today's behaviour, i.e. no direction (as
 * `materialHasGrain(null)` always was) and everything else like MDF (the 3D look of an unknown
 * material is MDF).
 */
const UNKNOWN_TRAITS: MaterialTraits = { ...MATERIAL_TRAITS.mdf, direction: NO_DIRECTION };

/** The behaviour row of a kind; `null` (unknown material) gives today's behaviour. */
export function traitsOf(kind: MaterialKind | null): MaterialTraits {
  return kind === null ? UNKNOWN_TRAITS : MATERIAL_TRAITS[kind];
}

/** Kinds of a family in menu order (`MATERIAL_KIND_IDS`), released kinds only. */
export function kindsOfFamily(family: MaterialFamily): MaterialKind[] {
  return MATERIAL_KIND_IDS.filter(
    (k) => MATERIAL_TRAITS[k].family === family && MATERIAL_TRAITS[k].release === 'released',
  );
}

/** T351: the chip load band of a tool diameter, or `null` when the kind has none. */
export function chipLoadBand(
  traits: Pick<MaterialTraits, 'chipLoad'>,
  diameter: number,
): { min: number; max: number; enforce: 'warn' | 'limit' } | null {
  const c = traits.chipLoad;
  if (!c) return null;
  let band: { min: number; max: number } | null = null;
  for (const b of c.bands) if (diameter >= b.minDiameter - 1e-9) band = b;
  return band ? { min: band.min, max: band.max, enforce: c.enforce } : null;
}

/** T351: rigidity factor on the step-down ceiling (analysis §4.2: light machine 0,25 × Ø of 0,5). */
export const RIGIDITY_STEP_DOWN_FACTOR = { light: 0.5, standard: 1, heavy: 1 } as const;

/**
 * T351: the highest step-down for a tool diameter on a machine of this rigidity (absent =
 * standard), mm; `null` when the kind has no ceiling. The machine tightens, never loosens (§4.1).
 */
export function stepDownCeiling(
  traits: Pick<MaterialTraits, 'stepDown'>,
  diameter: number,
  rigidity: keyof typeof RIGIDITY_STEP_DOWN_FACTOR = 'standard',
): number | null {
  const share = traits.stepDown.maxPerDiameter;
  if (share === null) return null;
  return Math.round(share * RIGIDITY_STEP_DOWN_FACTOR[rigidity] * diameter * 1000) / 1000;
}

/**
 * The thickness a kind starts at (T390 bench, T396 step 1): its second common thickness when it
 * has several presets (ACM 4 mm, aluminium 1,5 mm), else its only one; null = no presets (wood,
 * plastic: the profile's thicknesses decide, the thickness is kept).
 */
export function defaultThicknessOf(
  traits: Pick<MaterialTraits, 'thicknessPresets'>,
): number | null {
  const p = traits.thicknessPresets;
  return p[p.length > 1 ? 1 : 0] ?? null;
}
