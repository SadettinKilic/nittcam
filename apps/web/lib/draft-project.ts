import { defaultMachineProfile, nestingToolDiameter, type Project } from '@nittcam/core';

/**
 * Empty project for the parts step until the wizard (T023) creates and saves real projects.
 * The machine reference is a placeholder; the plate is a common 2800 × 2070 mm 18 mm MDF sheet.
 */
export function draftProject(): Project {
  return {
    schemaVersion: 1,
    machine: { machineId: 'draft', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
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
 * Tool diameter for nesting on the draft page: the example machine profile's tool for the draft's
 * material and thickness (MDF 18 → T2, 8 mm). The wizard (T023) passes the selected machine instead.
 */
export function draftToolDiameter(project: Project): number {
  return nestingToolDiameter(defaultMachineProfile(), project.stock) ?? 8;
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
