/**
 * T184 (spec §4.2, D-075): the sample project of the first-run tour. A base cabinet with two
 * hinge doors, built with the cabinet generator (T122) through the command layer on the sample
 * machine, so its revision-1 log replays to its data (D-029). Pure apart from the ids the caller
 * passes in.
 */
import {
  DEFAULT_CABINET,
  applyCommand,
  cabinetParts,
  cabinetPartsForStock,
  localBox,
  readyTemplate,
  type CabinetParams,
  type CommandLogEntry,
  type LibraryMaterial,
  type MachineProfile,
  type Project,
} from '@nittcam/core';
import { cabinetRows } from './cabinet-rows';
import { newProject, stockHasGrain } from './draft-project';
import { addTemplateParams, startPlacement } from './editor/template-place';
import type { MachineListItem } from './machines-api';
import type { Messages } from './messages';

/** The hinge of the sample doors: the ready Ø35 cup, 2 per door (a ~700 mm door). */
export const SAMPLE_HINGE_ID = 'ready-hinge-35-2';

/** An 800 mm base unit with two doors and one shelf; the board thickness follows the stock. */
export function sampleCabinet(thickness: number): CabinetParams {
  return {
    ...DEFAULT_CABINET,
    width: 800,
    height: 720,
    depth: 560,
    thickness,
    // No back: an 8 mm back would be another board (D-045); the sample stays on one sheet type.
    back: { mode: 'none', thickness: DEFAULT_CABINET.back.thickness },
    shelves: 1,
    doors: 2,
  };
}

/**
 * The sample machine: the seeded example machine when it is still active, else the first active
 * machine. Null when the company has no active machine.
 */
export function pickSampleMachine(machines: readonly MachineListItem[]): MachineListItem | null {
  const active = machines.filter((m) => !m.archived);
  return active.find((m) => m.example) ?? active[0] ?? null;
}

/**
 * The sample project: a new project on `machine` (library stock as usual, T259), one
 * `importCutList` with the cabinet rows, then one `addTemplate` per door row (hinge cups on the
 * left edge). Null when a command is rejected.
 */
export function buildSampleProject(
  machine: { id: string; version: number; profile: MachineProfile },
  library: readonly (LibraryMaterial & { id: string })[],
  t: { group: string; roles: Messages['cutList']['cabinet']['roles'] },
  newId: () => string,
  at: string,
): { project: Project; commands: CommandLogEntry[] } | null {
  let project = newProject(machine, library);
  const generated = cabinetParts(sampleCabinet(project.stock.thickness));
  if (!generated.ok) return null;
  const { rows } = cabinetPartsForStock(generated.parts, {
    thickness: project.stock.thickness,
    hasGrain: stockHasGrain(project.stock),
  });
  const commands: CommandLogEntry[] = [];
  const run = (command: string, params: unknown): boolean => {
    const res = applyCommand(project, command, params);
    if (!res.ok) return false;
    project = res.project;
    commands.push({ command, params: res.params, actor: 'user', at } as CommandLogEntry);
    return true;
  };
  const cutRows = cabinetRows(rows, t.roles, t.group, newId);
  if (!run('importCutList', { parts: cutRows })) return null;
  const hinge = readyTemplate(SAMPLE_HINGE_ID);
  if (!hinge) return null;
  rows.forEach((row, i) => {
    if (row.role !== 'door') return;
    const part = project.parts.find((p) => p.id === cutRows[i]?.id);
    if (!part) return;
    const pending = startPlacement(part.id, hinge, localBox(part), part.templates);
    run('addTemplate', addTemplateParams(pending));
  });
  return { project, commands };
}
