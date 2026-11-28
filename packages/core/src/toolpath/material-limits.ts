/**
 * T359 (spec §7.2 R13 / R14, §6.3, D-150): the material's step-down and chip-load limits checked
 * against what the job really cuts with, per job tool (T308: each tool with its own diameter and
 * flutes, the feed and rpm of `spindleSettingsOf`). Read by the validation (step 1 / Simülasyon
 * issues), the toolpath (an error stops the program) and the Kesim ayarları chip-load line.
 *
 * - `CHIP_LOAD_OUT_OF_RANGE`: feed / (rpm × flutes) outside the traits band of the tool's
 *   diameter (a V-bit its own band, a drill none). `limit` band (aluminium): error; `warn` band
 *   (ACM): warning. The fix is the feed that brings it back onto the nearer edge of the band.
 * - `STEP_DOWN_ABOVE_MATERIAL_LIMIT`: the job's step-down above traits × machine rigidity × tool Ø
 *   (end mills; a drill pecks ≤ 1 × Ø anyway, a V-bit has its own steps). Error.
 * - `SLOT_TOO_DEEP`: a contour tool cutting a full-width slot deeper than 3 × its Ø. Warning.
 *
 * Kinds whose traits have neither a chip-load band nor a step-down ceiling (wood, plastic) get
 * nothing. Pure.
 */
import { findMaterialParams, findTool, type MachineProfile } from '../machine';
import { materialKindOf } from '../machine/material';
import { chipLoadBand, stepDownCeiling, traitsOf } from '../machine/material-traits';
import type { Project } from '../schema';
import { contourTool, hasInnerCut } from './op-tools';
import { spindleSettingsOf, type ToolSpindle } from './spindle';

/** A full-width slot deeper than this multiple of the tool diameter warns (D-150). */
export const SLOT_DEPTH_PER_DIAMETER = 3;

export type MaterialLimitCode =
  'CHIP_LOAD_OUT_OF_RANGE' | 'STEP_DOWN_ABOVE_MATERIAL_LIMIT' | 'SLOT_TOO_DEEP';

export interface MaterialLimitFinding {
  code: MaterialLimitCode;
  severity: 'error' | 'warning';
  tool: number;
  /** Path into the project JSON / profile the user fixes (the feed of the tool, the set). */
  path: string;
  /** English message with the allowed range. */
  message: string;
}

/** The chip-load state of one job tool against its band (null = no band for this tool). */
export interface ChipLoadStatus {
  tool: number;
  value: number;
  min: number;
  max: number;
  enforce: 'warn' | 'limit';
  inBand: boolean;
  /** The feed, mm/min (whole tens, inside the band), that brings the chip load back; null in band. */
  fixFeed: number | null;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Chip-load status of a job tool row, from the stock's traits; null without a band. */
export function chipLoadStatus(
  project: Pick<Project, 'stock'>,
  row: Pick<ToolSpindle, 'tool' | 'diameter' | 'flutes' | 'rpm' | 'chipLoad'>,
  machine: Pick<MachineProfile, 'tools'>,
): ChipLoadStatus | null {
  const type = findTool(machine, row.tool)?.type;
  const band = chipLoadBand(traitsOf(materialKindOf(project.stock.material)), row.diameter, type);
  if (!band || !(row.rpm > 0) || !(row.flutes > 0)) return null;
  const v = row.chipLoad;
  const low = v < band.min - 1e-9;
  const high = v > band.max + 1e-9;
  const perTooth = row.rpm * row.flutes;
  // Round inwards to whole tens, so the fix lands inside the band.
  const fixFeed = high
    ? Math.floor((band.max * perTooth) / 10) * 10
    : low
      ? Math.ceil((band.min * perTooth) / 10) * 10
      : null;
  return {
    tool: row.tool,
    value: v,
    min: band.min,
    max: band.max,
    enforce: band.enforce,
    inBand: !low && !high,
    fixFeed,
  };
}

/** Every limit finding of the job (empty for kinds without limits and without a material set). */
export function materialLimitFindings(
  project: Project,
  machine: MachineProfile,
): MaterialLimitFinding[] {
  const traits = traitsOf(materialKindOf(project.stock.material));
  if (traits.chipLoad === null && traits.stepDown.maxPerDiameter === null) return [];
  const set = findMaterialParams(machine, project.stock);
  if (!set) return [];
  const out: MaterialLimitFinding[] = [];
  const rows = spindleSettingsOf(project, machine);
  for (const row of rows) {
    const st = chipLoadStatus(project, row, machine);
    if (st && !st.inBand) {
      out.push({
        code: 'CHIP_LOAD_OUT_OF_RANGE',
        severity: st.enforce === 'limit' ? 'error' : 'warning',
        tool: row.tool,
        path: `cutting.feeds.${row.tool}.feed`,
        message: `chip load ${r3(st.value)} mm/tooth of T${row.tool} (Ø${row.diameter}, ${row.flutes} flutes, F${row.feed} S${row.rpm}) is outside ${st.min}–${st.max} for ${project.stock.material}; set the feed to ${st.fixFeed} mm/min`,
      });
    }
  }
  const rigidity = machine.metal?.rigidity ?? 'standard';
  for (const row of rows) {
    const type = findTool(machine, row.tool)?.type;
    if (type === 'drill' || type === 'vBit') continue;
    const ceiling = stepDownCeiling(traits, row.diameter, rigidity);
    if (ceiling !== null && set.stepDown > ceiling + 1e-9) {
      out.push({
        code: 'STEP_DOWN_ABOVE_MATERIAL_LIMIT',
        severity: 'error',
        tool: row.tool,
        path: 'stock.material',
        message: `step-down ${set.stepDown} mm is above the ${ceiling} mm ceiling of T${row.tool} (Ø${row.diameter}) for ${project.stock.material} (${traits.stepDown.maxPerDiameter} × Ø, ${rigidity} machine); allowed 0–${ceiling} mm`,
      });
    }
  }
  const slotTools = new Set<number>([contourTool(project, 'outer', set.tool)]);
  if (hasInnerCut(project)) slotTools.add(contourTool(project, 'inner', set.tool));
  for (const n of [...slotTools].sort((a, b) => a - b)) {
    const tool = findTool(machine, n);
    if (!tool) continue;
    const limit = SLOT_DEPTH_PER_DIAMETER * tool.diameter;
    if (project.stock.thickness > limit + 1e-9) {
      out.push({
        code: 'SLOT_TOO_DEEP',
        severity: 'warning',
        tool: n,
        path: 'stock.thickness',
        message: `T${n} (Ø${tool.diameter}) cuts a full-width slot ${project.stock.thickness} mm deep, more than ${SLOT_DEPTH_PER_DIAMETER} × Ø = ${limit} mm`,
      });
    }
  }
  return out;
}

/**
 * T359: why `setToolFeed` / `setSpindleRpm` refuse a value: the tool's chip load with it would
 * leave a `limit` band (aluminium), with the band and the feed that fits. Undefined = allowed (no
 * band, a `warn` band, a tool outside the job, or back to the recommended value).
 */
export function chipLoadRefusal(
  project: Project,
  machine: MachineProfile,
  tool: number,
  change: { feed?: number | null | undefined; rpm?: number | null | undefined },
): string | undefined {
  if (typeof change.feed !== 'number' && typeof change.rpm !== 'number') return undefined;
  const key = String(tool);
  const cutting = { ...project.cutting };
  if (typeof change.feed === 'number') {
    cutting.feeds = { ...cutting.feeds, [key]: { ...cutting.feeds?.[key], feed: change.feed } };
  }
  if (typeof change.rpm === 'number') {
    cutting.spindleRpm = { ...cutting.spindleRpm, [key]: change.rpm };
  }
  const next = { ...project, cutting };
  const row = spindleSettingsOf(next, machine).find((r) => r.tool === tool);
  if (!row) return undefined;
  const st = chipLoadStatus(next, row, machine);
  if (!st || st.inBand || st.enforce !== 'limit') return undefined;
  return `chip load ${r3(st.value)} mm/tooth of T${tool} would be outside ${st.min}–${st.max} for ${project.stock.material}; set the feed to ${st.fixFeed} mm/min`;
}
