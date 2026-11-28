/**
 * Project material ↔ machine profile material sets (spec §3.6 "Malzeme = parametre seti", D-029).
 *
 * The project JSON keeps `stock.material` as a free id (D-010: older projects and fixtures say
 * "melamine-chipboard", users may type "MDF" or "kontrplak"), while a profile's material sets use
 * the fixed `MaterialKind` list. `materialKindOf` maps one onto the other, so cutting parameters
 * resolve for every spelling we know. Pure.
 */
import { EPS } from '../geometry/constants';
import { MATERIAL_KIND_IDS, type MaterialKind } from './material-kinds';
import { traitsOf, type MaterialTraits } from './material-traits';
import type { MachineProfile, MaterialParams } from './profile';
import type { LibraryMaterial } from './library';

/** Every material kind of the wizard, in menu order (§3.6). */
export const MATERIAL_KINDS: readonly MaterialKind[] = MATERIAL_KIND_IDS;

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
  acm: ['acm', 'kompozit', 'aluminyumkompozit', 'alukompozit', 'dibond', 'alucobond'],
  aluminium: ['aluminium', 'aluminum', 'aluminyum', 'alu', 'aluminyumlevha', 'aluminyumsac'],
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
 * Whether the material has a direction (grain) at all (§3.6): read from the behaviour table
 * (T341); today wood and laminated boards have one, plastics and unknown kinds none.
 */
export function materialHasGrain(kind: MaterialKind | null): boolean {
  return traitsOf(kind).direction.kind !== 'none';
}

/**
 * D-130 / T346: whether NC may leave the app for a project material: `released` (today's kinds and
 * unknown materials), `unverified` (ACM: header line + required checklist item) or `blocked`
 * (aluminium until T358 / T359).
 */
export function materialNcStatus(material: string): MaterialTraits['nc'] {
  return traitsOf(materialKindOf(material)).nc;
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

/** One thickness of an entry with the machine's parameter set for it (or none). */
export interface LibraryParamLink {
  thickness: number;
  params: MaterialParams | undefined;
}

/**
 * The parameter set a machine profile has for each thickness of a library entry (the "linked
 * parameter set per machine" of T121). A missing set is `undefined`: the wizard then shows the
 * "no cutting parameters" error, as for any stock.
 */
export function libraryParamLinks(
  material: Pick<LibraryMaterial, 'kind' | 'thicknesses'>,
  profile: Pick<MachineProfile, 'materials'>,
): LibraryParamLink[] {
  return material.thicknesses.map((thickness) => ({
    thickness,
    params: profile.materials.find(
      (m) => m.material === material.kind && Math.abs(m.thickness - thickness) <= EPS,
    ),
  }));
}
