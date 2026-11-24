/**
 * Built-in starting cutting values per material (T327, owner 2026-11-23, D-120). Plain data from
 * `docs/materials/kesim-degerleri-arastirma.md` (§c consolidated table, §d cautious starts); every
 * row names its sources (`S1`… of the research doc §e). The values are **starting points**: a
 * suggested set is always unverified and the operator confirms it on the machine (D-045, D-046).
 *
 * Kinds map to research rows as decided by the PO: `solidWood` uses the hardwood rows and `pvc`
 * the rigid PVC rows (the safe side); the softer variants are named in the material note. No row
 * for a combination means no suggestion, never a guessed number.
 *
 * Pure: no clock, randomness, network or UI.
 */
import type { MaterialKind } from './material-kinds';
import { PROFILE_BOUNDS, type Tool, type ToolType } from './profile';

/** Research doc source ids (§e) used by the rows. */
export type StartingValueSourceId =
  'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S9' | 'S12' | 'S13' | 'S15' | 'S16';

/** Short display name of each source (maker names, shown as is). */
export const STARTING_VALUE_SOURCE_NAMES: Record<StartingValueSourceId, string> = {
  S1: 'Freud',
  S2: 'Rennie Tool',
  S3: 'Amana',
  S4: 'Amana',
  S5: 'Amana',
  S9: 'ShopBot/Onsrud',
  S12: 'Leuco',
  S13: 'Leitz',
  S15: 'Acrylite',
  S16: 'Leitz',
};

/** How the tool enters the cut: straight plunge is fine, or a ramp is preferred / required. */
export type StartingEntry = 'straight' | 'rampPreferred' | 'rampRequired';
export type StartingCoolant = 'none' | 'air';

/** Translation key of the material note (UI text lives in the web translation files). */
export type StartingNoteKey =
  | 'plywoodFace'
  | 'melamineFace'
  | 'melamineNoCompression'
  | 'solidWoodHard'
  | 'acrylicPlastic'
  | 'pvcRigid';

export interface StartingValueRow {
  /** Stable id, e.g. `mdf-flatEndMill-2-8`. */
  id: string;
  kind: MaterialKind;
  toolType: ToolType;
  flutes: number;
  /** Nominal diameter of the band (mm); see `DIAMETER_BANDS`. */
  diameter: number;
  /**
   * Chip load, mm per tooth. `min` / `max` are the lowest and highest industrial source values
   * (research §c `cl_min` / `cl_max`); `typ` is the cautious start (§c `cl_start`, §d). The start
   * may lie below `min` on purpose (research §d: the low end, MDF Ø8 0,167 is today's value).
   */
  chipLoad: { min: number; typ: number; max: number };
  /** Spindle speed, rpm (research §c). */
  rpm: { min: number; typ: number; max: number };
  /**
   * Starting step-down as a share of the tool diameter (research §c `stepDown`). The melamine
   * compression rows go deeper than 1 × D (first pass ≥ the down-cut length, S16); their `typ`
   * chip load already carries the research depth correction (§c "Derinlik düzeltmesi").
   */
  stepDownFactor: number;
  /** Plunge feed as a share of the feed (research §c `plunge`). */
  plungeShare: number;
  entry: StartingEntry;
  coolant: StartingCoolant;
  sources: readonly StartingValueSourceId[];
  note?: StartingNoteKey;
}

/** Diameter bands: the metric size and its nearest inch size (research "Gösterim kuralları"). */
export const DIAMETER_BANDS: readonly { nominal: number; min: number; max: number }[] = [
  { nominal: 3, min: 2.9, max: 3.3 }, // 3, 1/8" = 3,175
  { nominal: 4, min: 3.9, max: 4.9 }, // 4, 5/32" = 3,97, 3/16" = 4,76
  { nominal: 6, min: 5.9, max: 6.5 }, // 6, 1/4" = 6,35
  { nominal: 8, min: 7.8, max: 8.1 }, // 8, 5/16" = 7,94
  { nominal: 10, min: 9.4, max: 10.1 }, // 10, 3/8" = 9,53
  { nominal: 12, min: 11.9, max: 12.8 }, // 12, 1/2" = 12,7
];

type RowInput = [
  diameter: number,
  clMin: number,
  clTyp: number,
  clMax: number,
  stepDownFactor: number,
  sources: StartingValueSourceId[],
];

const WOOD_RPM = { min: 18000, typ: 18000, max: 24000 };
const PLASTIC_RPM = { min: 14000, typ: 18000, max: 22000 };

function rows(
  kind: MaterialKind,
  toolType: ToolType,
  flutes: number,
  common: Pick<StartingValueRow, 'rpm' | 'plungeShare' | 'entry' | 'coolant'> & {
    note?: StartingNoteKey;
  },
  list: RowInput[],
): StartingValueRow[] {
  return list.map(([diameter, min, typ, max, stepDownFactor, sources]) => ({
    id: `${kind}-${toolType}-${flutes}-${diameter}`,
    kind,
    toolType,
    flutes,
    diameter,
    chipLoad: { min, typ, max },
    stepDownFactor,
    sources,
    ...common,
  }));
}

const WOOD = { rpm: WOOD_RPM, plungeShare: 0.25, coolant: 'none' } as const;
/**
 * Plastics plunge at 0,25 × feed (PO B61 decision, D-120), not the research's 0,5: that share
 * assumes a ramp entry, but a project enters with a straight plunge by default. The material note
 * still says a ramp entry is recommended.
 */
const PLASTIC = { rpm: PLASTIC_RPM, plungeShare: 0.25, coolant: 'air' } as const;

/** The table (research §c; §d where §c has no row). */
export const STARTING_VALUE_ROWS: readonly StartingValueRow[] = [
  // MDF, two-flute spiral (§c mdf). Ø8: today's built-in set (6000 / 1500 / 18 000 / 6).
  ...rows('mdf', 'flatEndMill', 2, { ...WOOD, entry: 'straight' }, [
    [3, 0.1, 0.1, 0.18, 1, ['S1', 'S2', 'S3']],
    [4, 0.1, 0.1, 0.21, 1, ['S2', 'S3']],
    [6, 0.15, 0.15, 0.43, 1, ['S1', 'S2', 'S3', 'S9']],
    [8, 0.23, 0.167, 0.5, 0.75, ['S2', 'S3']],
    [10, 0.27, 0.22, 0.59, 0.75, ['S1', 'S2', 'S3']],
    [12, 0.24, 0.24, 0.69, 0.5, ['S1', 'S2', 'S3']],
  ]),
  // Plywood, two-flute spiral (§c plywood).
  ...rows('plywood', 'flatEndMill', 2, { ...WOOD, entry: 'straight', note: 'plywoodFace' }, [
    [3, 0.08, 0.08, 0.15, 1, ['S1', 'S2', 'S3']],
    [4, 0.1, 0.08, 0.18, 1, ['S2']],
    [6, 0.13, 0.13, 0.33, 1, ['S1', 'S2', 'S3']],
    [8, 0.14, 0.14, 0.42, 0.75, ['S2', 'S3']],
    [10, 0.16, 0.16, 0.52, 0.75, ['S1', 'S2', 'S3']],
    [12, 0.145, 0.16, 0.56, 0.5, ['S1', 'S2', 'S3']],
  ]),
  // Melamine, two-flute compression (§c melamine): first pass ≥ the down-cut length (S16). Ø6:
  // 1 × D (6 mm), not the research's 1,5 × D (PO B61 decision: the most breakable tool in the
  // table, too heavy for a first cut on a light router); Ø8 and larger keep their rows.
  ...rows('melamine', 'compression', 2, { ...WOOD, entry: 'rampPreferred', note: 'melamineFace' }, [
    [6, 0.155, 0.13, 0.38, 1, ['S1', 'S4', 'S16']],
    [8, 0.155, 0.15, 0.5, 1.1, ['S2', 'S4', 'S16']],
    [10, 0.28, 0.2, 0.59, 0.9, ['S1', 'S2', 'S4']],
    [12, 0.28, 0.22, 0.69, 0.75, ['S1', 'S2', 'S4']],
  ]),
  // Melamine without a compression tool, two-flute spiral Ø8 (§d "compression yoksa"; band of
  // the melamine Ø8 row).
  ...rows(
    'melamine',
    'flatEndMill',
    2,
    { ...WOOD, entry: 'rampPreferred', note: 'melamineNoCompression' },
    [[8, 0.155, 0.139, 0.5, 0.75, ['S1', 'S2']]],
  ),
  // Solid wood: the hardwood rows (PO decision; §c solidWoodHard), 0,5 × D.
  ...rows(
    'solidWood',
    'flatEndMill',
    2,
    { ...WOOD, entry: 'rampPreferred', note: 'solidWoodHard' },
    [
      [3, 0.05, 0.06, 0.13, 0.5, ['S1', 'S2']],
      [4, 0.1, 0.08, 0.15, 0.5, ['S2']],
      [6, 0.127, 0.1, 0.28, 0.5, ['S1', 'S2', 'S3', 'S9']],
      [8, 0.137, 0.12, 0.37, 0.5, ['S2', 'S3']],
      [10, 0.163, 0.14, 0.48, 0.5, ['S1', 'S2', 'S3']],
      [12, 0.145, 0.15, 0.53, 0.5, ['S1', 'S2', 'S3']],
    ],
  ),
  // Acrylic, single-flute O-flute (§c acrylic, z = 1).
  ...rows(
    'acrylic',
    'flatEndMill',
    1,
    { ...PLASTIC, entry: 'rampRequired', note: 'acrylicPlastic' },
    [
      [3, 0.1, 0.1, 0.15, 0.5, ['S5', 'S13', 'S15']],
      [4, 0.15, 0.12, 0.2, 0.5, ['S5']],
      [6, 0.11, 0.167, 0.33, 0.5, ['S5', 'S12', 'S13']],
      [8, 0.23, 0.2, 0.33, 0.5, ['S5', 'S2']],
      [10, 0.28, 0.22, 0.41, 0.5, ['S5']],
    ],
  ),
  ...rows(
    'acrylic',
    'flatEndMill',
    1,
    {
      ...PLASTIC,
      rpm: { min: 14000, typ: 16000, max: 18000 },
      entry: 'rampRequired',
      note: 'acrylicPlastic',
    },
    [[12, 0.38, 0.25, 0.51, 0.5, ['S5', 'S15']]],
  ),
  // Acrylic, two-flute up-cut spiral (§c acrylic, z = 2).
  ...rows(
    'acrylic',
    'flatEndMill',
    2,
    { ...PLASTIC, entry: 'rampRequired', note: 'acrylicPlastic' },
    [
      [6, 0.13, 0.12, 0.25, 0.5, ['S1', 'S2']],
      [8, 0.17, 0.14, 0.28, 0.5, ['S1', 'S2']],
    ],
  ),
  // PVC: the rigid PVC rows (PO decision; §c pvcRigid), z = 1 and z = 2.
  ...rows('pvc', 'flatEndMill', 1, { ...PLASTIC, entry: 'rampRequired', note: 'pvcRigid' }, [
    [3, 0.05, 0.08, 0.15, 0.5, ['S1', 'S5']],
    [6, 0.13, 0.15, 0.3, 0.5, ['S1', 'S2', 'S5']],
    [8, 0.18, 0.18, 0.33, 0.5, ['S2', 'S5']],
  ]),
  ...rows('pvc', 'flatEndMill', 2, { ...PLASTIC, entry: 'rampRequired', note: 'pvcRigid' }, [
    [6, 0.13, 0.12, 0.22, 0.5, ['S1', 'S2']],
    [8, 0.18, 0.14, 0.24, 0.5, ['S2']],
  ]),
];

/** Nominal diameter of the band holding `diameter`, or undefined between bands. */
export function diameterBand(diameter: number): number | undefined {
  return DIAMETER_BANDS.find((b) => diameter >= b.min && diameter <= b.max)?.nominal;
}

/** The table row for a kind and tool, or undefined (no row = no suggestion). */
export function startingValueRow(
  kind: MaterialKind,
  tool: Pick<Tool, 'type' | 'diameter' | 'flutes'>,
): StartingValueRow | undefined {
  const band = diameterBand(tool.diameter);
  if (band === undefined) return undefined;
  return STARTING_VALUE_ROWS.find(
    (r) =>
      r.kind === kind &&
      r.toolType === tool.type &&
      r.flutes === tool.flutes &&
      r.diameter === band,
  );
}

export interface CuttingSuggestion {
  feed: number;
  plungeFeed: number;
  rpm: number;
  stepDown: number;
  /** Chip load of the suggested feed and rpm, mm per tooth. */
  chipLoad: number;
  row: StartingValueRow;
}

/**
 * Research depth correction (§c "Derinlik düzeltmesi", S1, S3, S9): the chip load share at a cut
 * depth of `depthOverD` × the tool diameter: 1 up to 1 × D, 0,75 at 2 × D, 0,5 at 3 × D and
 * deeper, linear in between. The rows deeper than 1 × D (melamine compression) already carry it
 * in their `typ` chip load, so `suggestCuttingSet` does not apply it a second time; a test keeps
 * every such row at or below its corrected band.
 */
export function depthChipLoadFactor(depthOverD: number): number {
  if (!(depthOverD > 1)) return 1;
  if (depthOverD >= 3) return 0.5;
  return 1 - 0.25 * (depthOverD - 1);
}

/** Nearest 100; exactly between goes down (the safe side, PO B61). */
const round100 = (v: number) => Math.ceil(Math.round(v * 1e6) / 1e6 / 100 - 0.5) * 100;
/** Down to the 100 (plunge feed, the safe side, PO B61). */
const floor100 = (v: number) => Math.floor(Math.round(v * 1e6) / 1e6 / 100) * 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Starting cutting values for `kind` at `thickness` mm with `tool` on a spindle of
 * `spindle.minRpm`–`spindle.maxRpm`, or undefined when the table has no row (never a guess).
 * - rpm: the row's typical speed clamped to the spindle range;
 * - feed: chip load × flutes × rpm, nearest 100 mm/min, exactly between goes down (recomputed
 *   after the rpm clamp);
 * - plunge feed: the row's plunge share of the feed, down to the 100 mm/min (the safe side);
 * - step-down: the row's share of the tool diameter (rounded to 0,5 mm), never above the tool's
 *   flute length or the sheet thickness.
 */
export function suggestCuttingSet(
  kind: MaterialKind,
  thickness: number,
  tool: Pick<Tool, 'type' | 'diameter' | 'flutes' | 'fluteLength'>,
  spindle: { minRpm: number; maxRpm: number },
): CuttingSuggestion | undefined {
  const row = startingValueRow(kind, tool);
  if (!row) return undefined;
  const lo = Math.min(spindle.minRpm, spindle.maxRpm);
  const hi = Math.max(spindle.minRpm, spindle.maxRpm);
  const rpm = Math.round(clamp(row.rpm.typ, lo, hi));
  const feed = clamp(
    round100(row.chipLoad.typ * row.flutes * rpm),
    PROFILE_BOUNDS.feed.min,
    PROFILE_BOUNDS.feed.max,
  );
  const plungeFeed = clamp(
    floor100(row.plungeShare * feed),
    PROFILE_BOUNDS.feed.min,
    Math.min(feed, PROFILE_BOUNDS.plungeFeed.max),
  );
  let stepDown = Math.round(row.stepDownFactor * tool.diameter * 2) / 2;
  stepDown = Math.min(stepDown, tool.fluteLength);
  if (Number.isFinite(thickness) && thickness > 0) stepDown = Math.min(stepDown, thickness);
  return { feed, plungeFeed, rpm, stepDown, chipLoad: feed / (row.flutes * rpm), row };
}

/** Distinct short source names of a row, in order (for "Başlangıç değeri: …"). */
export function startingValueSourceNames(row: Pick<StartingValueRow, 'sources'>): string[] {
  return [...new Set(row.sources.map((s) => STARTING_VALUE_SOURCE_NAMES[s]))];
}

/**
 * A hint when the tool type does not suit the material (research §a rule 3), or null. A hint,
 * never a block: melamine wants a compression tool, acrylic and PVC a single-flute O-flute.
 */
export type ToolFitHint = 'melamineCompression' | 'plasticSingleFlute';

export function toolFitHint(
  kind: MaterialKind,
  tool: Pick<Tool, 'type' | 'flutes'>,
): ToolFitHint | null {
  if (kind === 'melamine' && tool.type !== 'compression') return 'melamineCompression';
  if ((kind === 'acrylic' || kind === 'pvc') && tool.flutes !== 1) return 'plasticSingleFlute';
  return null;
}
