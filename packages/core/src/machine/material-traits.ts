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
export type MaterialFamily = 'woodBoard' | 'plastic';

/** Every family in picker order. */
export const MATERIAL_FAMILIES: readonly MaterialFamily[] = ['woodBoard', 'plastic'];

/** Operations that pick a cutting tool (mirrors `OPERATION_TOOL_KINDS` in `toolpath/op-tools`). */
export type TraitsOperation = 'outer' | 'inner' | 'pocket' | 'hole';

export interface MaterialTraits {
  family: MaterialFamily;
  /** `flagged`: shown only behind a feature flag (none of today's kinds). */
  release: 'released' | 'flagged';
  direction: {
    /**
     * `none`: the material has no direction (no grain field anywhere); `axial`: 30° = 210°
     * (wood grain, today's only kind of direction).
     */
    kind: 'none' | 'axial';
    /** Which wording the screens use for the direction ("Damar yönü"). */
    label: 'grain';
    /** Whether a new sheet / offcut of this kind starts with a direction (0°). */
    defaultOn: boolean;
  };
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
  };
  /** Small parts (auto tabs / skin): outline area below `area` mm² or a side below `minSide` mm. */
  smallPart: { area: number; minSide: number };
  /** Sheet size presets of step 1 (short × long side, mm). */
  sheetPresets: readonly { a: number; b: number }[];
  look: {
    /** Token custom property of the base colour (`packages/ui/src/tokens.css`). */
    token: string;
    /** 3D surface roughness (matte everywhere). */
    roughness: number;
    /** Visible grain stripes in the procedural texture. */
    stripes: boolean;
    /** Procedural texture noise amplitude. */
    noise: number;
  };
}

const WOOD_TOOLS: MaterialTraits['toolTypes'] = {
  outer: ['flatEndMill', 'compression'],
  inner: ['flatEndMill', 'compression'],
  pocket: ['flatEndMill', 'compression'],
  hole: ['drill', 'flatEndMill'],
};

const TABS: MaterialTraits['tabs'] = {
  defaults: { count: 4, width: 10, materialLeft: 3, smallPartMinCount: 2 },
  bounds: { minWidth: 3, minAnchor: 3, minHeight: 1, belowThickness: 1 },
};

const SKIN: MaterialTraits['skin'] = { min: 0.2, belowThickness: 1 };

const SMALL_PART: MaterialTraits['smallPart'] = { area: 50_000, minSide: 100 };

const SHEET_PRESETS: MaterialTraits['sheetPresets'] = [
  { a: 1220, b: 2440 },
  { a: 2100, b: 2800 },
  { a: 2070, b: 2800 },
];

/** Shared part of the two families today: everything but the family, direction and look. */
const BOARD = {
  release: 'released',
  toolTypes: WOOD_TOOLS,
  tabs: TABS,
  skin: SKIN,
  smallPart: SMALL_PART,
  sheetPresets: SHEET_PRESETS,
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
    look: { token: '--color-mat-mdf', roughness: 0.92, stripes: false, noise: NOISE.fibre },
  },
  plywood: {
    ...BOARD,
    family: 'woodBoard',
    direction: GRAIN,
    look: { token: '--color-mat-plywood', roughness: 0.92, stripes: true, noise: NOISE.stripes },
  },
  melamine: {
    ...BOARD,
    family: 'woodBoard',
    direction: GRAIN,
    look: { token: '--color-mat-melamine', roughness: 0.92, stripes: false, noise: NOISE.flat },
  },
  solidWood: {
    ...BOARD,
    family: 'woodBoard',
    direction: GRAIN,
    look: { token: '--color-mat-solid-wood', roughness: 0.92, stripes: true, noise: NOISE.stripes },
  },
  acrylic: {
    ...BOARD,
    family: 'plastic',
    direction: NO_DIRECTION,
    look: { token: '--color-mat-acrylic', roughness: 0.55, stripes: false, noise: NOISE.flat },
  },
  pvc: {
    ...BOARD,
    family: 'plastic',
    direction: NO_DIRECTION,
    look: { token: '--color-mat-pvc', roughness: 0.7, stripes: false, noise: NOISE.flat },
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
