import {
  findMaterialParams,
  nestingToolDiameter,
  type MachineProfile,
  type Project,
} from '@nittcam/core';

/** The sheet a new project starts with: a common 2070 × 2800 mm board, long side along X. */
export const DEFAULT_SHEET = { width: 2800, height: 2070 } as const;

/** Tool diameter (mm) when the machine is unknown: the example machine's 8 mm end mill. */
export const FALLBACK_TOOL_DIAMETER = 8;

/**
 * A new project (T023): the given machine profile version, its first material set (else MDF
 * 18 mm) and the default sheet. Nothing is stored until the first change (D-029).
 */
export function newProject(machine?: {
  id: string;
  version: number;
  profile: MachineProfile;
}): Project {
  const set = machine?.profile.materials[0];
  return {
    schemaVersion: 1,
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
