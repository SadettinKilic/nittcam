import {
  findMaterialParams,
  materialHasGrain,
  materialKindOf,
  libraryParamLinks,
  nestingToolDiameter,
  stockFromLibrary,
  type LibraryMaterial,
  type MachineProfile,
  type Project,
} from '@nittcam/core';

/** The sheet a new project starts with: a common 2070 × 2800 mm board, long side along X. */
export const DEFAULT_SHEET = { width: 2800, height: 2070 } as const;

/** Tool diameter (mm) when the machine is unknown: the example machine's 8 mm end mill. */
export const FALLBACK_TOOL_DIAMETER = 8;

/**
 * The library entry and thickness a new project starts on (T259, D-045): the first entry with a
 * thickness the machine has cutting parameters for. `undefined` when none can be cut.
 */
export function firstUsableLibraryStock(
  library: readonly (LibraryMaterial & { id: string })[],
  profile: Pick<MachineProfile, 'materials'>,
): { entry: LibraryMaterial & { id: string }; thickness: number } | undefined {
  for (const entry of library) {
    const link = libraryParamLinks(entry, profile).find((l) => l.params !== undefined);
    if (link) return { entry, thickness: link.thickness };
  }
  return undefined;
}

/**
 * A new project (T023): the given machine profile version and the default sheet. The stock is the
 * company library's first entry the machine can cut (T259), else the profile's first material set
 * (else MDF 18 mm). Nothing is stored until the first change (D-029).
 */
export function newProject(
  machine?: {
    id: string;
    version: number;
    profile: MachineProfile;
  },
  library: readonly (LibraryMaterial & { id: string })[] = [],
): Project {
  const set = machine?.profile.materials[0];
  const usable = machine ? firstUsableLibraryStock(library, machine.profile) : undefined;
  if (usable) {
    const base = newProject(machine);
    const pick = stockFromLibrary(usable.entry, {
      thickness: usable.thickness,
      sheet: base.stock.sheet,
    });
    base.stock = {
      ...base.stock,
      libraryId: usable.entry.id,
      material: pick.material,
      thickness: pick.thickness,
      sheet: { width: pick.width, height: pick.height, grain: pick.grain },
    };
    return base;
  }
  return {
    schemaVersion: 2,
    machine: machine
      ? { machineId: machine.id, profileVersion: machine.version }
      : { machineId: 'draft', profileVersion: 1 },
    stock: {
      material: set?.material ?? 'mdf',
      thickness: set?.thickness ?? 18,
      sheet: { ...DEFAULT_SHEET, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  };
}

/**
 * Tool diameter for nesting and the locked-placement rule (D-019, D-020): the selected machine's
 * tool for the stock (material mapped to the profile sets, D-029), else the fallback.
 */
export function toolDiameterFor(project: Project, profile: MachineProfile | null): number {
  return (profile && nestingToolDiameter(profile, project.stock)) ?? FALLBACK_TOOL_DIAMETER;
}

/** Does the machine have cutting parameters for the project's stock? */
export function hasCuttingParams(project: Project, profile: MachineProfile | null): boolean {
  return profile !== null && findMaterialParams(profile, project.stock) !== undefined;
}

let counter = 0;

/** A new part id. Ids come from the caller, never from core (D-011). */
export function newPartId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `p-${c.randomUUID()}`;
  counter += 1;
  return `p-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Fills `{name}` placeholders in a translation string. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}

/**
 * Does the stock have a grain? Wood with a sheet grain set; plastics and a sheet grain "Yok"
 * (null, e.g. library MDF) have none (T259, T260).
 */
export function stockHasGrain(stock: Project['stock']): boolean {
  return materialHasGrain(materialKindOf(stock.material)) && stock.sheet.grain !== null;
}
