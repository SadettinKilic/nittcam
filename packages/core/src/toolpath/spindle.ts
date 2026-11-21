/**
 * T307 (D-098): spindle speed (devir) per tool of a job. The recommended value is automatic: the
 * rpm of the material parameter set chosen for the job (machine × material × thickness, its tool).
 * Tools used in the job without their own set (hole tools) get the machine's value for this job,
 * which is that same set rpm (what the toolpath has always cut with). A project may override the
 * value per tool (`project.cutting.spindleRpm`, command `setSpindleRpm`); the toolpath, the NC
 * `S` word and the "KESİM" header read the override. It must stay inside the machine's spindle
 * range: the command, the validation, the toolpath and the post refuse values outside. Pure.
 */
import {
  feedInRange,
  findMaterialParams,
  findTool,
  machineFeedLimits,
  type MachineProfile,
} from '../machine';
import type { Project } from '../schema';
import {
  contourPocketTool,
  contourTool,
  effectiveHoleTool,
  hasContourPocket,
  hasInnerCut,
  recommendedFeeds,
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
  /** T323: cutting feed of this tool in the job, mm/min: the project's own value, else recommended. */
  feed: number;
  /** T323: plunge feed of this tool in the job, mm/min. */
  plungeFeed: number;
  /** T323: the feeds of the tool's material set (the job set unless the tool was chosen, T308). */
  recommendedFeed: number;
  recommendedPlungeFeed: number;
  /** T323: the project holds its own cutting / plunge feed for this tool. */
  feedOverride: boolean;
  plungeOverride: boolean;
  /** T323: an own feed outside the machine's limits (old or hand-edited project). */
  feedOutOfRange: boolean;
  plungeOutOfRange: boolean;
  /** Chip load, mm per tooth: feed / (rpm × flutes), with this tool's own feed. */
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

/** T323: the project's own feeds for a tool (each field absent = recommended). */
export function feedOverride(
  project: Project,
  tool: number,
): { feed?: number | undefined; plungeFeed?: number | undefined } {
  return project.cutting.feeds?.[String(tool)] ?? {};
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
    const rec = recommendedFeeds(project, machine, set, n);
    const ownFeed = feedOverride(project, n);
    const limits = machineFeedLimits();
    const feed = ownFeed.feed ?? rec.feed;
    const row: ToolSpindle = {
      tool: n,
      diameter: tool.diameter,
      flutes: tool.flutes,
      recommended,
      rpm,
      override: own !== undefined,
      feed,
      plungeFeed: ownFeed.plungeFeed ?? rec.plungeFeed,
      recommendedFeed: rec.feed,
      recommendedPlungeFeed: rec.plungeFeed,
      feedOverride: ownFeed.feed !== undefined,
      plungeOverride: ownFeed.plungeFeed !== undefined,
      feedOutOfRange: ownFeed.feed !== undefined && !feedInRange(limits.feed, ownFeed.feed),
      plungeOutOfRange:
        ownFeed.plungeFeed !== undefined && !feedInRange(limits.plungeFeed, ownFeed.plungeFeed),
      chipLoad: rpm > 0 && tool.flutes > 0 ? feed / (rpm * tool.flutes) : 0,
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

/**
 * T323: the job tools with an own feed, for the "İLERLEME" header lines (tool, the feeds the job
 * cuts with, the recommended ones). Empty with the recommended feeds, so programs stay unchanged.
 */
export function feedOverridesOf(
  project: Project,
  machine: MachineProfile,
): {
  tool: number;
  feed: number;
  plungeFeed: number;
  recommendedFeed: number;
  recommendedPlungeFeed: number;
}[] {
  return spindleSettingsOf(project, machine)
    .filter((s) => s.feedOverride || s.plungeOverride)
    .map((s) => ({
      tool: s.tool,
      feed: s.feed,
      plungeFeed: s.plungeFeed,
      recommendedFeed: s.recommendedFeed,
      recommendedPlungeFeed: s.recommendedPlungeFeed,
    }));
}
