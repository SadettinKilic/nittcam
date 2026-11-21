/**
 * T307 (D-098): spindle speed (devir) per tool of a job. The recommended value is automatic: the
 * rpm of the material parameter set chosen for the job (machine × material × thickness, its tool).
 * Tools used in the job without their own set (hole tools) get the machine's value for this job,
 * which is that same set rpm (what the toolpath has always cut with). A project may override the
 * value per tool (`project.cutting.spindleRpm`, command `setSpindleRpm`); the toolpath, the NC
 * `S` word and the "KESİM" header read the override. It must stay inside the machine's spindle
 * range: the command, the validation, the toolpath and the post refuse values outside. Pure.
 */
import { findMaterialParams, findTool, type MachineProfile } from '../machine';
import type { Project } from '../schema';
import {
  contourPocketTool,
  contourTool,
  effectiveHoleTool,
  hasContourPocket,
  hasInnerCut,
  recommendedRpm,
} from './op-tools';

/** Slider step, typed-value step, and the half-width of the "uygun aralık" band (±20 %). */
export const SPINDLE_RPM_STEP = 500;
export const SPINDLE_RPM_INPUT_STEP = 100;
export const SPINDLE_RPM_PAGE_STEP = 1_000;
export const SPINDLE_RPM_BAND = 0.2;

export type RpmBand = 'ok' | 'high' | 'low';

export interface ToolSpindle {
  tool: number;
  diameter: number;
  flutes: number;
  /** The material set's rpm for this job. */
  recommended: number;
  /** What the job cuts with: the project's override, else `recommended`. */
  rpm: number;
  /** True when the project holds its own value for this tool. */
  override: boolean;
  /** Feed of the job, mm/min (the material set's). */
  feed: number;
  /** Chip load, mm per tooth: feed / (rpm × flutes). */
  chipLoad: number;
  band: RpmBand;
  /** Signed deviation from `recommended`, whole percent (e.g. 30 for 30 % higher). */
  deviation: number;
  /** The override lies outside the machine's spindle range (old or hand-edited project). */
  outOfRange: boolean;
}

/** The project's own value for a tool, if any. */
export function spindleOverride(project: Project, tool: number): number | undefined {
  return project.cutting.spindleRpm?.[String(tool)];
}

/** Whether `rpm` lies inside the machine's spindle range. */
export function rpmInRange(machine: Pick<MachineProfile, 'spindle'>, rpm: number): boolean {
  return Number.isFinite(rpm) && rpm >= machine.spindle.minRpm && rpm <= machine.spindle.maxRpm;
}

/** Band of `rpm` against `recommended` (±`SPINDLE_RPM_BAND`) and the signed whole-percent deviation. */
export function rpmBand(rpm: number, recommended: number): { band: RpmBand; deviation: number } {
  const ratio = recommended > 0 ? (rpm - recommended) / recommended : 0;
  const deviation = Math.round(ratio * 100);
  const eps = 1e-9;
  if (ratio > SPINDLE_RPM_BAND + eps) return { band: 'high', deviation };
  if (ratio < -SPINDLE_RPM_BAND - eps) return { band: 'low', deviation };
  return { band: 'ok', deviation };
}

/**
 * The tools the job cuts with, in tool-number order: the outer contour tool (also on-line
 * operations), the inner contour tool when the job has inner cuts, and every hole tool the machine
 * has. By default the first two are the material set's tool and the holes their own (T308 lets
 * the project choose per operation). Empty without a set.
 */
export function jobToolNumbers(project: Project, machine: MachineProfile): number[] {
  const set = findMaterialParams(machine, project.stock);
  if (!set) return [];
  const tools = new Set<number>([contourTool(project, 'outer', set.tool)]);
  if (hasInnerCut(project)) tools.add(contourTool(project, 'inner', set.tool));
  if (hasContourPocket(project)) tools.add(contourPocketTool(project, set.tool));
  for (const part of project.parts) {
    for (const h of part.holes) tools.add(effectiveHoleTool(project, h));
  }
  return [...tools].filter((n) => findTool(machine, n)).sort((a, b) => a - b);
}

/** One row per tool of the job (see `jobToolNumbers`); empty without a material set. */
export function spindleSettingsOf(project: Project, machine: MachineProfile): ToolSpindle[] {
  const set = findMaterialParams(machine, project.stock);
  if (!set) return [];
  return jobToolNumbers(project, machine).flatMap((n) => {
    const tool = findTool(machine, n);
    if (!tool) return [];
    const own = spindleOverride(project, n);
    const recommended = recommendedRpm(project, machine, set, n);
    const rpm = own ?? recommended;
    const { band, deviation } = rpmBand(rpm, recommended);
    const row: ToolSpindle = {
      tool: n,
      diameter: tool.diameter,
      flutes: tool.flutes,
      recommended,
      rpm,
      override: own !== undefined,
      feed: set.feed,
      chipLoad: rpm > 0 && tool.flutes > 0 ? set.feed / (rpm * tool.flutes) : 0,
      band,
      deviation,
      outOfRange: own !== undefined && !rpmInRange(machine, own),
    };
    return [row];
  });
}

/** Overrides of the job's tools, for the "KESİM" header: `[[2, 20000, 18000]]` (tool, rpm, recommended). */
export function spindleOverridesOf(
  project: Project,
  machine: MachineProfile,
): { tool: number; rpm: number; recommended: number }[] {
  return spindleSettingsOf(project, machine)
    .filter((s) => s.override)
    .map((s) => ({ tool: s.tool, rpm: s.rpm, recommended: s.recommended }));
}
