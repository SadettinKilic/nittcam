/**
 * Project material ↔ machine profile material sets (spec §3.6 "Malzeme = parametre seti", D-029).
 *
 * The project JSON keeps `stock.material` as a free id (D-010: older projects and fixtures say
 * "melamine-chipboard", users may type "MDF" or "kontrplak"), while a profile's material sets use
 * the fixed `MaterialKind` list. `materialKindOf` maps one onto the other, so cutting parameters
 * resolve for every spelling we know. Pure.
 */
import { EPS } from '../geometry/constants';
import {
  materialKindSchema,
  type MachineProfile,
  type MaterialKind,
  type MaterialParams,
} from './profile';

/** Every material kind of the wizard, in menu order (§3.6). */
export const MATERIAL_KINDS: readonly MaterialKind[] = materialKindSchema.options;

/**
 * Known spellings per kind, compared after `normalizeMaterialId` (lower case, Turkish letters
 * folded, separators removed). The kind's own id is always accepted.
 */
const ALIASES: Record<MaterialKind, readonly string[]> = {
  mdf: ['mdf', 'mdflam', 'hdf'],
  plywood: ['plywood', 'kontrplak', 'kontraplak', 'ply', 'multiplex'],
  melamine: [
    'melamine',
    'melamin',
    'melaminechipboard',
    'melaminkaplisunta',
    'melaminkaplimdf',
    'sunta',
    'lam',
    'laminat',
    'laminate',
    'chipboard',
    'yongalevha',
  ],
  solidWood: ['solidwood', 'masif', 'masifahsap', 'ahsap', 'wood', 'kereste'],
  acrylic: ['acrylic', 'akrilik', 'pleksi', 'pleksiglas', 'plexiglass', 'pmma'],
  pvc: ['pvc', 'foreks', 'forex', 'pvcfoam', 'sertpvc'],
};

const FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

/** Lower case, Turkish letters folded, everything but `a–z0–9` removed. */
export function normalizeMaterialId(id: string): string {
  return id
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
}

const LOOKUP: ReadonlyMap<string, MaterialKind> = new Map(
  MATERIAL_KINDS.flatMap((kind) =>
    [kind, ...ALIASES[kind]].map((alias) => [normalizeMaterialId(alias), kind] as const),
  ),
);

/** The profile material kind for a project material id, or null when we do not know it. */
export function materialKindOf(material: string): MaterialKind | null {
  return LOOKUP.get(normalizeMaterialId(material)) ?? null;
}

/**
 * Grain direction only matters for wood and laminated boards (§3.6 "Damar yönü: yalnızca ahşap ve
 * kaplamalı malzemede görünür"); plastics have none.
 */
export function materialHasGrain(kind: MaterialKind | null): boolean {
  return kind === 'mdf' || kind === 'plywood' || kind === 'melamine' || kind === 'solidWood';
}

/**
 * The profile's parameter set for the stock: same material kind (via `materialKindOf`) and the
 * same thickness within EPS. `undefined` when the profile has none (→ `NO_CUTTING_PARAMS`).
 */
export function findMaterialParams(
  profile: Pick<MachineProfile, 'materials'>,
  stock: { material: string; thickness: number },
): MaterialParams | undefined {
  const kind = materialKindOf(stock.material);
  if (kind === null) return undefined;
  return profile.materials.find(
    (m) => m.material === kind && Math.abs(m.thickness - stock.thickness) <= EPS,
  );
}

/** Thicknesses the profile has parameter sets for, per kind, ascending. */
export function profileThicknesses(
  profile: Pick<MachineProfile, 'materials'>,
  kind: MaterialKind,
): number[] {
  return [
    ...new Set(profile.materials.filter((m) => m.material === kind).map((m) => m.thickness)),
  ].sort((a, b) => a - b);
}
