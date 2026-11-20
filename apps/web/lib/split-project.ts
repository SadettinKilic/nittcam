/**
 * T292 (CTO #10 E7): parts of another board thickness (a cabinet's 8 mm back) go to a new project
 * on the same machine and profile version, with the chosen material and thickness. The new
 * project is built through the command layer, so its revision-1 log replays to its data (D-029).
 */
import { applyCommand, type CommandLogEntry, type Project } from '@nittcam/core';

export interface SplitTarget {
  material: string;
  thickness: number;
}

/**
 * The new project: the source's machine binding, stock sheet, nesting and cutting options, no
 * parts and no layout; then `setMaterial` / `setThickness` when they differ and one
 * `importCutList` with `rows`. Null when a command is rejected (e.g. no rows, bad thickness).
 */
export function splitOffProject(
  source: Project,
  rows: readonly unknown[],
  target: SplitTarget,
  at: string,
): { project: Project; commands: CommandLogEntry[] } | null {
  if (rows.length === 0) return null;
  let project: Project = {
    schemaVersion: source.schemaVersion,
    machine: { ...source.machine },
    stock: structuredClone(source.stock),
    parts: [],
    nesting: structuredClone(source.nesting),
    layout: { sheets: [] },
    cutting: structuredClone(source.cutting),
    settings: structuredClone(source.settings),
  };
  const commands: CommandLogEntry[] = [];
  const steps: [string, unknown][] = [];
  if (target.material !== source.stock.material) {
    steps.push(['setMaterial', { material: target.material }]);
  }
  if (target.thickness !== source.stock.thickness) {
    steps.push(['setThickness', { thickness: target.thickness }]);
  }
  steps.push(['importCutList', { parts: rows }]);
  for (const [command, params] of steps) {
    const res = applyCommand(project, command, params);
    if (!res.ok) return null;
    project = res.project;
    commands.push({ command, params: res.params, actor: 'user', at } as CommandLogEntry);
  }
  return { project, commands };
}
