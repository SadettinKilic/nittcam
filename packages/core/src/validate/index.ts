/**
 * Rule validation (spec §7.3, §5.4, §8.1 step 4). Runs after every command and returns the
 * warning/error list. The schema stays permissive (D-010); rules that need data from more than one
 * place (stock + part, tool table + hole) live here. Pure: same project, same list.
 */
import { EPS } from '../geometry';
import { findMaterialParams, findTool, machineFeedLimits, type MachineProfile } from '../machine';
import { allowedRotations, rotationAllowed, rotationPolicyOf } from '../geometry/grain';
import { fitsUsableAny, partBoxSize, partShape, rotationOptions, usableSize } from '../nesting/fit';
import { nestingEngineOf } from '../nesting/nest';
import { checkPlacement, partSizes } from '../nesting/placement';
import { nestingToolDiameter } from '../nesting/tool';
import type { Hole, Project } from '../schema';
import {
  defaultSheet,
  deriveOutline,
  stockSheetSizes,
  sheetSizeOf,
  formatPath,
  innerOperation,
} from '../schema';
import { blindDepthInvalid, checkHolePlacement, holeToolProblem } from '../editor/holes';
import { checkInnerContour, innerFitsTool } from '../editor/inners';
import { lineLeavesPart } from '../editor/lines';
import { contour } from '../geometry/polyline';
import { contourPocketRings } from '../toolpath/contour-pocket';
import { unsecuredSlugs } from '../toolpath/slug-check';
import { spindleSettingsOf } from '../toolpath/spindle';
import {
  contourPocketTool,
  contourTool,
  effectiveHoleTool,
  holeToolKind,
  operationToolChoice,
  operationsInJob,
} from '../toolpath/op-tools';
import { operationToolProblem } from '../toolpath/op-tool-choice';
import { toCutSizes } from '../schema/cut-size';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'PART_LARGER_THAN_SHEET'
  | 'HOLE_DEPTH_NOT_BELOW_THICKNESS'
  | 'HOLE_DEPTH_NEAR_THICKNESS'
  | 'TOOL_NOT_IN_PROFILE'
  | 'HOLE_SMALLER_THAN_TOOL'
  | 'GROOVE_NARROWER_THAN_TOOL'
  | 'DRILL_SIZE_MISMATCH'
  | 'LOCKED_PLACEMENT_INVALID'
  | 'LOCKED_PLACEMENT_GRAIN'
  | 'PLACEMENT_GRAIN'
  | 'NO_CUTTING_PARAMS'
  | 'CUTTING_PARAMS_UNVERIFIED'
  | 'SPINDLE_RPM_OUT_OF_RANGE'
  | 'FEED_OUT_OF_RANGE'
  | 'FEED_ABOVE_RECOMMENDED'
  | 'OPERATION_TOOL_UNSUITABLE'
  | 'SHEET_LARGER_THAN_TABLE'
  | 'HOLE_OUTSIDE_PART'
  | 'INNER_CONTOUR_INVALID'
  | 'INNER_CONTOUR_TOO_SMALL'
  | 'INNER_SLUG_UNSECURED'
  | 'LINE_OUTSIDE_PART'
  | 'PART_NOT_IN_LAYOUT'
  | 'MARGIN_BELOW_TOOL_RADIUS'
  | 'POCKET_DEPTH_NOT_BELOW_THICKNESS'
  | 'POCKET_DEPTH_NEAR_THICKNESS'
  | 'POCKET_TOO_SMALL';

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  /** Path into the project JSON, like `parts[0].holes[1].depth`. */
  path: string;
  /** English message; the UI shows a translated text keyed by `code`. */
  message: string;
}

/**
 * Data from outside the project JSON that some rules need. The caller passes it in, so validation
 * stays pure. `machine` is the profile version the project has selected (`project.machine`);
 * without it the tool rules are skipped.
 */
export interface ValidationContext {
  machine?: MachineProfile | undefined;
  /**
   * Cutting tool diameter (mm) for the spacing rule of locked placements. When it is missing it
   * comes from `machine` (`nestingToolDiameter`, D-019); without either it counts as 0, so only
   * the gap is required between parts.
   */
  toolDiameter?: number | undefined;
}

/** A rule inspects the project and returns its issues (possibly none). */
export type ValidationRule = (project: Project, context?: ValidationContext) => ValidationIssue[];

/** A size for messages: at most 3 decimals (EPS = 0.001 mm), no trailing zeros. */
function mm(v: number): string {
  return String(Number(v.toFixed(3)));
}

/**
 * (a) A part that fits the usable sheet area in no allowed orientation (spec §5.4 "parça plakadan
 * büyük mü"). The usable area is the sheet minus `nesting.margin` on every side (T012, D-019),
 * the same room the placer has, so a part flagged here is exactly a part the placer reports
 * `TOO_LARGE`. A fixed-grain part may only take its `allowedRotations` (D-034; on a 0°/90° sheet
 * that is 0°/180° or 90°/270°, at other angles the bbox of the rotated outline); a free part may turn 90°. Freeform parts use the arc-aware bbox of their
 * outline (T006). The gap and tool diameter only matter between parts and are not counted.
 */
export const partLargerThanSheet: ValidationRule = (project) => {
  const { width, height } = defaultSheet(project);
  const { margin } = project.nesting;
  const usable = usableSize(defaultSheet(project), margin);
  const usables = [usable, ...stockSheetSizes(project).map((d) => usableSize(d, margin))];
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    const size = partBoxSize(part);
    // The forced grain rotation counts (D-034): the same footprints the placer tries.
    const rotations = allowedRotations(
      part,
      defaultSheet(project),
      rotationPolicyOf(project.nesting),
    );
    const options = rotationOptions(partShape(part), rotations);
    // T164: with several stock sizes a part only needs to fit one of them.
    if (usables.some((u) => fitsUsableAny(options, u))) return;
    const locked = part.grain.mode === 'fixed' && defaultSheet(project).grain !== null;
    const how = !locked
      ? 'in any orientation'
      : rotations.every((r) => r === 0 || r === 180)
        ? 'grain-locked, no 90° turn'
        : `grain-locked, only at ${rotations.map(mm).join('° / ')}°`;
    const room =
      margin > 0
        ? `the ${mm(usable.width)} × ${mm(usable.height)} mm usable area of the ${width} × ${height} mm sheet (margin ${mm(margin)} mm)`
        : `the ${width} × ${height} mm sheet`;
    issues.push({
      code: 'PART_LARGER_THAN_SHEET',
      severity: 'error',
      path: formatPath(['parts', i, part.kind === 'rect' ? 'params' : 'outline']),
      message: `part "${part.id}" (${mm(size.w)} × ${mm(size.h)} mm) does not fit on ${room} (${how})`,
    });
  });
  return issues;
};

/**
 * (a2) T287 (CTO #10 A, K2): once a layout exists, every copy of every part must be on a sheet.
 * A copy that is not (added after nesting, the stock ran out, ...) would be missing from the
 * G-code without a word, so it is an error that blocks the NC export, and the Simülasyon badge
 * reads the same list (`exportBlockingIssues`). A part already reported by
 * `PART_LARGER_THAN_SHEET` is not reported twice. One issue per part, on `parts[i]`.
 */
export const partNotInLayout: ValidationRule = (project, context) => {
  if (!project.layout.sheets.some((s) => s.placements.length > 0)) return [];
  const tooLarge = new Set(
    partLargerThanSheet(project, context).map((i) => /^parts\[(\d+)\]/.exec(i.path)?.[1]),
  );
  const placed = new Map<string, Set<number>>();
  for (const sheet of project.layout.sheets) {
    for (const pl of sheet.placements) {
      const set = placed.get(pl.partId) ?? new Set<number>();
      set.add(pl.index);
      placed.set(pl.partId, set);
    }
  }
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    if (tooLarge.has(String(i))) return;
    const have = placed.get(part.id);
    let missing = 0;
    for (let k = 0; k < part.qty; k++) if (!have?.has(k)) missing++;
    if (missing === 0) return;
    issues.push({
      code: 'PART_NOT_IN_LAYOUT',
      severity: 'error',
      path: formatPath(['parts', i]),
      message: `${missing} of ${part.qty} copies of part "${part.id}" are not in the layout; nest again`,
    });
  });
  return issues;
};

/** Material a blind hole must leave under it before the "too close" warning, mm (T140). */
export const HOLE_MIN_SKIN = 1;

function isBlind(hole: Hole): hole is Extract<Hole, { depth: number }> {
  return hole.type === 'pocket' || hole.type === 'groove';
}

/**
 * (b) Blind depth must be smaller than the stock thickness (spec §4.5 "Kör derinlik malzeme
 * kalınlığından küçük olmalı"). Applies to pockets and grooves, the two hole types with a depth.
 * Too close (§4.5 "çok yakınsa uyarı", T140): less than HOLE_MIN_SKIN mm left under it is a warning.
 */
export const holeDepthBelowThickness: ValidationRule = (project) => {
  const { thickness } = project.stock;
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    part.holes.forEach((hole, h) => {
      if (!isBlind(hole)) return;
      // Same rule as the toolpath (T275, blindDepthInvalid).
      if (!blindDepthInvalid(hole, thickness)) {
        // Blind but with less than HOLE_MIN_SKIN mm left: it may break through (T140).
        if (thickness - hole.depth < HOLE_MIN_SKIN - EPS) {
          issues.push({
            code: 'HOLE_DEPTH_NEAR_THICKNESS',
            severity: 'warning',
            path: formatPath(['parts', i, 'holes', h, 'depth']),
            message: `${hole.type} "${hole.id}" in part "${part.id}" leaves ${mm(thickness - hole.depth)} mm under it (less than ${HOLE_MIN_SKIN} mm of the ${thickness} mm stock)`,
          });
        }
        return;
      }
      issues.push({
        code: 'HOLE_DEPTH_NOT_BELOW_THICKNESS',
        severity: 'error',
        path: formatPath(['parts', i, 'holes', h, 'depth']),
        message: `${hole.type} "${hole.id}" in part "${part.id}" is ${hole.depth} mm deep; a blind depth must be less than the ${thickness} mm stock thickness`,
      });
    });
  });
  return issues;
};

/**
 * (c) Tool vs hole (spec §4.5), using the tool table of the selected machine profile (T010):
 * - the hole's tool number must exist in the profile (`TOOL_NOT_IN_PROFILE`, error);
 * - pocket/through: "Çap takım çapından küçük olamaz" → `d < tool diameter` is an error
 *   (equal is fine: a single plunge or drill cycle);
 * - groove: "Kanal genişliği takım çapına eşitse tek geçiş, büyükse çok geçiş; küçükse uyarı" →
 *   `grooveWidth < tool diameter` is an error since T275: the toolpath refuses it, so it is caught
 *   where the hole is drawn (D-045).
 * The rule is `holeToolProblem`, shared with the toolpath.
 * Comparisons allow EPS, so a hole within 0.001 mm of the tool diameter counts as equal.
 * Skipped when the caller passes no profile.
 */
export const holeVsTool: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine) return [];
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    part.holes.forEach((hole, h) => {
      // T308: the project's tool for the hole's operation, else the hole's own.
      const toolNo = effectiveHoleTool(project, hole);
      const problem = holeToolProblem({ ...hole, tool: toolNo }, machine.tools);
      if (!problem) return;
      const tool = findTool(machine, toolNo);
      if (!tool || problem.code === 'TOOL_NOT_IN_PROFILE') {
        issues.push({
          code: 'TOOL_NOT_IN_PROFILE',
          severity: 'error',
          path: formatPath(['parts', i, 'holes', h, 'tool']),
          message: `${hole.type} "${hole.id}" in part "${part.id}" uses tool T${toolNo}, which is not in the machine's tool table`,
        });
        return;
      }
      if (hole.type === 'groove') {
        if (problem.code === 'GROOVE_NARROWER_THAN_TOOL') {
          issues.push({
            code: 'GROOVE_NARROWER_THAN_TOOL',
            severity: 'error',
            path: formatPath(['parts', i, 'holes', h, 'grooveWidth']),
            message: `groove "${hole.id}" in part "${part.id}" is ${mm(hole.grooveWidth)} mm wide, narrower than the ${mm(tool.diameter)} mm tool T${tool.number}`,
          });
        }
        return;
      }
      if (problem.code === 'HOLE_SMALLER_THAN_TOOL') {
        issues.push({
          code: 'HOLE_SMALLER_THAN_TOOL',
          severity: 'error',
          path: formatPath(['parts', i, 'holes', h, 'd']),
          message: `${hole.type} "${hole.id}" in part "${part.id}" is ${mm(hole.d)} mm, smaller than the ${mm(tool.diameter)} mm tool T${tool.number}`,
        });
      }
      // T320 (D-108): a drill drills only its own size. A chosen operation tool is reported once,
      // as OPERATION_TOOL_UNSUITABLE (D-099), not twice.
      if (
        problem.code === 'DRILL_SIZE_MISMATCH' &&
        operationToolChoice(project, holeToolKind(hole)) === undefined
      ) {
        issues.push({
          code: 'DRILL_SIZE_MISMATCH',
          severity: 'error',
          path: formatPath(['parts', i, 'holes', h, 'tool']),
          message: `${hole.type} "${hole.id}" in part "${part.id}" (Ø${mm(hole.d)} mm) uses the Ø${mm(tool.diameter)} mm drill T${tool.number}; a drill only drills a hole of its own size, a bigger hole or a groove needs a mill`,
        });
      }
    });
  });
  return issues;
};

/** The tool diameter the spacing rules use (see `ValidationContext.toolDiameter`). */
export function validationToolDiameter(project: Project, context?: ValidationContext): number {
  if (context?.toolDiameter !== undefined) return context.toolDiameter;
  if (context?.machine) return nestingToolDiameter(context.machine, project.stock) ?? 0;
  return 0;
}

/**
 * (d) Locked placements (spec §6.2 "Elle müdahale", D-020): a locked part copy must lie on the
 * sheet, outside the margin band, and at least `toolDiameter + gap` from every other placed part
 * on its sheet (the placer's spacing, D-019). Re-nesting never moves a locked copy, so a bad lock
 * would reach the toolpath unchanged: error. Unlocked placements come from the placer and are
 * correct by construction; they are only counted as neighbours here.
 */
export const lockedPlacementInvalid: ValidationRule = (project, context) => {
  const toolDiameter = validationToolDiameter(project, context);
  const sizes = partSizes(project);
  // A true-shape layout (T167) is checked on the real footprints, not the bboxes.
  const trueShape = nestingEngineOf(project) === 'trueShape';
  const issues: ValidationIssue[] = [];
  project.layout.sheets.forEach((sheet, s) => {
    sheet.placements.forEach((pl, p) => {
      if (!pl.locked || !sizes.has(pl.partId)) return;
      const check = checkPlacement(project, s, pl, { toolDiameter, trueShape }, sizes);
      const reasons: string[] = [];
      if (check.outsideSheet) reasons.push('lies outside the sheet');
      if (check.inMargin) reasons.push(`lies in the ${mm(project.nesting.margin)} mm margin`);
      if (check.conflicts.length > 0) {
        const names = check.conflicts.map((c) => `"${c.partId}" #${c.index + 1}`).join(', ');
        reasons.push(
          `is closer than ${mm(toolDiameter + project.nesting.gap)} mm (tool + gap) to ${names}`,
        );
      }
      if (reasons.length === 0) return;
      issues.push({
        code: 'LOCKED_PLACEMENT_INVALID',
        severity: 'error',
        path: formatPath(['layout', 'sheets', s, 'placements', p]),
        message: `locked copy ${pl.index + 1} of part "${pl.partId}" on sheet ${s + 1} ${reasons.join(' and ')}`,
      });
    });
  });
  return issues;
};

/**
 * (d2) A placed copy at a rotation its grain does not allow (D-034 amendment): e.g. the sheet or
 * part grain changed after nesting. One issue per copy, never two:
 * - locked copy → `LOCKED_PLACEMENT_GRAIN`: the lock is the user's choice, so re-nesting keeps it
 *   in place and nothing moves it silently; the user unlocks or turns it.
 * - unlocked copy → `PLACEMENT_GRAIN`: nesting only runs on demand (Diz), so the copy keeps its
 *   stale rotation until the user re-nests.
 * The NC export (web `runExport`) refuses the project while either is reported
 * (`EXPORT_BLOCKING_CODES`). Same rotation comparison as `allowedRotations` everywhere else
 * (`rotationAllowed`, 3 decimals).
 */
export const placementGrain: ValidationRule = (project) => {
  const parts = new Map(project.parts.map((p) => [p.id, p]));
  const issues: ValidationIssue[] = [];
  project.layout.sheets.forEach((sheet, s) => {
    sheet.placements.forEach((pl, p) => {
      const part = parts.get(pl.partId);
      const policy = rotationPolicyOf(project.nesting);
      if (!part || rotationAllowed(part, defaultSheet(project), pl.rot, policy)) return;
      const allowed = allowedRotations(part, defaultSheet(project), policy);
      const what = pl.locked ? 'locked copy' : 'copy';
      issues.push({
        code: pl.locked ? 'LOCKED_PLACEMENT_GRAIN' : 'PLACEMENT_GRAIN',
        severity: 'error',
        path: formatPath(['layout', 'sheets', s, 'placements', p]),
        message: `${what} ${pl.index + 1} of part "${pl.partId}" on sheet ${s + 1} is at ${pl.rot}°, which its grain does not allow (allowed: ${allowed.join(', ')}°)${pl.locked ? '' : '; re-nest'}`,
      });
    });
  });
  return issues;
};

/**
 * Validation codes that block the NC export on the server (web `runExport`): the toolpath itself
 * accepts any rotation (D-034 stage 1), so a copy cut against the grain is stopped there.
 */
export const EXPORT_BLOCKING_CODES: ReadonlySet<ValidationCode> = new Set<ValidationCode>([
  'LOCKED_PLACEMENT_GRAIN',
  'PLACEMENT_GRAIN',
]);

/**
 * (e) The selected machine has no cutting parameter set for the stock (spec §3.6 "Malzeme =
 * parametre seti", D-029): the toolpath cannot be built (`NO_CUTTING_PARAMS`, D-021), so it is
 * an error the user sees in the wizard before nesting. The stock material id is mapped to the
 * profile's material kinds (`findMaterialParams`). Skipped without a profile.
 */
export const noCuttingParams: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine || findMaterialParams(machine, project.stock)) return [];
  return [
    {
      code: 'NO_CUTTING_PARAMS',
      severity: 'error',
      path: 'stock.material',
      message: `the machine has no cutting parameters for ${project.stock.material} ${mm(project.stock.thickness)} mm`,
    },
  ];
};

/**
 * (e2) The stock's parameter set holds unconfirmed starting values (`unverified`, T265): the fix
 * flow added it and the user has not confirmed or edited it, so it does not count as configured.
 * An error, like a missing set; the toolpath refuses it too. Skipped without a profile.
 */
export const unverifiedCuttingParams: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine || !findMaterialParams(machine, project.stock)?.unverified) return [];
  return [
    {
      code: 'CUTTING_PARAMS_UNVERIFIED',
      severity: 'error',
      path: 'stock.material',
      message: `the cutting parameters for ${project.stock.material} ${mm(project.stock.thickness)} mm are unconfirmed starting values`,
    },
  ];
};

/**
 * (e3) T308 (D-099): a tool chosen per operation that no longer suits the job (wrong type, too
 * short, wider than the layout spacing, a drill for holes of another size). An error; the
 * toolpath refuses it too; "Önerilene dön" clears it. Skipped without a profile.
 */
export const operationToolUnsuitable: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine || !project.cutting.tools) return [];
  return operationsInJob(project).flatMap((op) => {
    const tool = operationToolChoice(project, op);
    if (tool === undefined) return [];
    const problem = operationToolProblem(project, machine, op, tool);
    // Hole sizes and inner openings are reported where they are drawn (rules above).
    if (problem === null || problem === 'HOLE_SMALLER' || (op === 'inner' && problem === 'CONTOUR'))
      return [];
    return [
      {
        code: 'OPERATION_TOOL_UNSUITABLE' as const,
        severity: 'error' as const,
        path: `cutting.tools.${op}`,
        message: `tool T${tool} chosen for the ${op} operation does not suit this job (${problem})`,
      },
    ];
  });
};

/**
 * (e2) T307 (D-098): a project spindle speed outside the selected machine's spindle range (an old
 * project on another machine, or a hand-edited file). An error: the toolpath and the post refuse it
 * too; "Önerilene dön" clears it. Only the job's tools count (a stale value of an unused tool is
 * never cut). Skipped without a profile.
 */
export const spindleRpmOutOfRange: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine || !project.cutting.spindleRpm) return [];
  return spindleSettingsOf(project, machine)
    .filter((s) => s.outOfRange)
    .map(({ tool, rpm }) => ({
      code: 'SPINDLE_RPM_OUT_OF_RANGE' as const,
      severity: 'error' as const,
      path: `cutting.spindleRpm.${tool}`,
      message: `spindle speed ${rpm} rpm for T${tool} is outside the machine's range ${machine.spindle.minRpm}–${machine.spindle.maxRpm}`,
    }));
};

/**
 * (e2b) T323: a project feed or plunge feed outside the selected machine's limits (an old project
 * on another machine, or a hand-edited file). An error: the toolpath and the post refuse it too;
 * "Önerilene dön" clears it. Only the job's tools count. Skipped without a profile.
 */
export const feedOutOfRange: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine || !project.cutting.feeds) return [];
  const limits = machineFeedLimits(machine);
  const out: ValidationIssue[] = [];
  for (const s of spindleSettingsOf(project, machine)) {
    if (s.feedOutOfRange) {
      out.push({
        code: 'FEED_OUT_OF_RANGE',
        severity: 'error',
        path: `cutting.feeds.${s.tool}.feed`,
        message: `feed ${s.feed} mm/min for T${s.tool} is outside the machine's range ${limits.feed.min}–${limits.feed.max}`,
      });
    }
    if (s.plungeOutOfRange) {
      out.push({
        code: 'FEED_OUT_OF_RANGE',
        severity: 'error',
        path: `cutting.feeds.${s.tool}.plungeFeed`,
        message: `plunge feed ${s.plungeFeed} mm/min for T${s.tool} is outside the machine's range ${limits.plungeFeed.min}–${limits.plungeFeed.max}`,
      });
    }
  }
  return out;
};

/**
 * (e2c) T330 (D-121, field rehearsal B1): a job feed or plunge feed more than 1,5 × its
 * recommendation, or a chip load more than 2 × the set's, typically one extra zero typed in
 * Kesim ayarları. A warning (counted in Uyarılar, a checklist line to tick), not an error: the
 * machine ceiling is the error (`FEED_OUT_OF_RANGE`). One issue per tool and value.
 */
export const feedAboveRecommended: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine) return [];
  const out: ValidationIssue[] = [];
  for (const s of spindleSettingsOf(project, machine)) {
    if (s.feedOutOfRange || s.plungeOutOfRange) continue;
    if (s.feedHigh) {
      out.push({
        code: 'FEED_ABOVE_RECOMMENDED',
        severity: 'warning',
        path: `cutting.feeds.${s.tool}.feed`,
        message: `feed ${s.feed} mm/min for T${s.tool} is more than 1.5 × the recommended ${s.recommendedFeed}`,
      });
    }
    if (s.plungeHigh) {
      out.push({
        code: 'FEED_ABOVE_RECOMMENDED',
        severity: 'warning',
        path: `cutting.feeds.${s.tool}.plungeFeed`,
        message: `plunge feed ${s.plungeFeed} mm/min for T${s.tool} is more than 1.5 × the recommended ${s.recommendedPlungeFeed}`,
      });
    }
    if (s.chipLoadHigh && !s.feedHigh) {
      out.push({
        code: 'FEED_ABOVE_RECOMMENDED',
        severity: 'warning',
        path: `cutting.feeds.${s.tool}.feed`,
        message: `chip load ${s.chipLoad.toFixed(3)} mm for T${s.tool} is more than 2 × the recommended ${s.recommendedChipLoad.toFixed(3)}`,
      });
    }
  }
  return out;
};

/**
 * T300 (CTO #12 E1, D-085): the smallest sheet margin that keeps the cutter on the sheet. An
 * outside profile runs the tool centre one radius outside the part, so a part on a margin below
 * the radius sends the tool past the sheet edge (and past the work envelope when the sheet sits
 * at the machine origin). Leads are clipped to the sheet by the toolpath, so the radius is enough.
 */
export function minSheetMargin(toolDiameter: number): number {
  return toolDiameter > 0 ? toolDiameter / 2 : 0;
}

/**
 * (e2) T300 (D-045, D-085): the sheet margin is below the tool radius. A warning on the Dizilim
 * step, before the G-code check stops the export with a machine error. Skipped without a tool.
 */
export const marginBelowToolRadius: ValidationRule = (project, context) => {
  const tool = validationToolDiameter(project, context);
  const min = minSheetMargin(tool);
  if (min <= 0 || project.nesting.margin >= min - EPS) return [];
  return [
    {
      code: 'MARGIN_BELOW_TOOL_RADIUS',
      severity: 'warning',
      path: 'nesting.margin',
      message: `the ${mm(project.nesting.margin)} mm sheet margin is below the ${mm(min)} mm radius of the Ø${mm(tool)} mm tool; the tool leaves the sheet`,
    },
  ];
};

/**
 * (f) The sheet does not fit the machine table at its place (`origin.sheetOffset`), spec §3.6
 * "Plaka tablaya sığmıyorsa uyarı". A warning here; the automatic G-code check blocks the export
 * (`SHEET_OUTSIDE_TABLE`, D-027). EPS slack. Skipped without a profile.
 */
export const sheetLargerThanTable: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine) return [];
  const off = machine.origin.sheetOffset;
  // Every stock size and every size a layout sheet uses (T164), the default sheet first, once each.
  const sizes = [
    { ...defaultSheet(project), path: 'stock.sheet' },
    ...stockSheetSizes(project).map((s, i) => ({ ...s, path: `stock.sheets.${i}` })),
    ...project.layout.sheets.map((_, i) => ({
      ...sheetSizeOf(project, i),
      path: `layout.sheets.${i}.size`,
    })),
  ];
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const { width, height, path } of sizes) {
    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fits =
      off.x + width <= machine.table.width + EPS && off.y + height <= machine.table.depth + EPS;
    if (fits) continue;
    out.push({
      code: 'SHEET_LARGER_THAN_TABLE',
      severity: 'warning',
      path,
      message: `the ${mm(width)} × ${mm(height)} mm sheet does not fit the ${mm(machine.table.width)} × ${mm(machine.table.depth)} mm table`,
    });
  }
  return out;
};

/**
 * (h) Each hole lies inside its part, clear of the cut-outs (T138, spec §4.5). The hole commands
 * refuse such a hole, but an outline edit or a removed/added cut-out can break it later (D-045):
 * error, the toolpath refuses it too (a hole outside the part would cut the neighbour).
 */
export const holeInsidePart: ValidationRule = (project) => {
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    if (part.holes.length === 0) return;
    const outline = deriveOutline(part);
    part.holes.forEach((hole, h) => {
      const err = checkHolePlacement(outline, part.inners, hole);
      if (!err) return;
      issues.push({
        code: 'HOLE_OUTSIDE_PART',
        severity: 'error',
        path: formatPath(['parts', i, 'holes', h]),
        message: `${hole.type} "${hole.id}" in part "${part.id}" ${err === 'outside' ? 'does not lie inside the part outline' : 'touches or overlaps a cut-out'}`,
      });
    });
  });
  return issues;
};

/**
 * (g) Inner contours (T134, spec §4.3, D-045 "catch it where it is caused"): each cut-out must lie
 * inside the outline and not touch an earlier one (an outline edit can break that after the
 * cut-out was added), and the cutting tool of the selected machine must fit through it
 * (the same offset the toolpath uses). Both are errors: the toolpath could not cut the part.
 */
export const innerContourRules: ValidationRule = (project, context) => {
  const machine = context?.machine;
  const params = machine ? findMaterialParams(machine, project.stock) : undefined;
  const tool =
    machine && params ? findTool(machine, contourTool(project, 'inner', params.tool)) : undefined;
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    if (part.inners.length === 0) return;
    const outline = deriveOutline(part);
    part.inners.forEach((inner, k) => {
      const path = formatPath(['parts', i, 'inners', k]);
      const err = checkInnerContour(outline, part.inners.slice(0, k), inner, 0);
      if (err) {
        issues.push({
          code: 'INNER_CONTOUR_INVALID',
          severity: 'error',
          path,
          message: `inner contour ${k + 1} of part "${part.name}" is invalid (${err})`,
        });
      } else if (
        tool &&
        innerOperation(part, k).kind === 'inside' &&
        !innerFitsTool(inner, tool.diameter)
      ) {
        // T142: only a through cut inside the line needs the tool to fit.
        issues.push({
          code: 'INNER_CONTOUR_TOO_SMALL',
          severity: 'error',
          path,
          message: `inner contour ${k + 1} of part "${part.name}" is too small or too narrow for the ${mm(tool.diameter)} mm tool`,
        });
      }
    });
  });
  return issues;
};

/**
 * (g1) Contour pockets (T325, D-112): the depth must stay below the stock thickness (error; the
 * same rule as the toolpath), less than HOLE_MIN_SKIN mm left under it is a warning (as for blind
 * holes), and the `pocket` operation's tool must fit (`contourPocketRings`, the toolpath's own
 * rings: the pocket at least as wide as the tool and one connected area). Skipped without a
 * profile for the tool rule.
 */
export const innerPocketRules: ValidationRule = (project, context) => {
  const machine = context?.machine;
  const params = machine ? findMaterialParams(machine, project.stock) : undefined;
  const tool =
    machine && params ? findTool(machine, contourPocketTool(project, params.tool)) : undefined;
  const { thickness } = project.stock;
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    part.inners.forEach((inner, k) => {
      const op = innerOperation(part, k);
      if (op.kind !== 'pocket') return;
      const name = `pocket ${k + 1} of part "${part.name}"`;
      if (!(op.depth < thickness - EPS)) {
        issues.push({
          code: 'POCKET_DEPTH_NOT_BELOW_THICKNESS',
          severity: 'error',
          path: formatPath(['parts', i, 'inners', k]),
          message: `${name} is ${mm(op.depth)} mm deep; a pocket must be less deep than the ${thickness} mm stock`,
        });
        return;
      }
      if (thickness - op.depth < HOLE_MIN_SKIN - EPS) {
        issues.push({
          code: 'POCKET_DEPTH_NEAR_THICKNESS',
          severity: 'warning',
          path: formatPath(['parts', i, 'inners', k]),
          message: `${name} leaves ${mm(thickness - op.depth)} mm under it (less than ${HOLE_MIN_SKIN} mm of the ${thickness} mm stock)`,
        });
      }
      if (tool && !contourPocketRings(contour(inner), tool.diameter).ok) {
        issues.push({
          code: 'POCKET_TOO_SMALL',
          severity: 'error',
          path: formatPath(['parts', i, 'inners', k]),
          message: `${name} is too small or too narrow for the ${mm(tool.diameter)} mm tool`,
        });
      }
    });
  });
  return issues;
};

/**
 * (g2) A cut-out whose slug has no room for 2 tabs (T270, D-049, D-045): the toolpath refuses it
 * (`SMALL_SLUG_UNSECURED`, the cutter could throw the slug), so it is an error on the cut-out where
 * it is drawn, from the same `buildToolpath` rule (`unsecuredSlugs`). Skipped without a profile.
 */
export const innerSlugTabs: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine || !project.parts.some((p) => p.inners.length > 0)) return [];
  return unsecuredSlugs(project, machine).map(({ part, inner }) => ({
    code: 'INNER_SLUG_UNSECURED' as const,
    severity: 'error' as const,
    path: formatPath(['parts', part, 'inners', inner]),
    message: `inner contour ${inner + 1} of part "${project.parts[part]?.name ?? ''}": no room for 2 tabs on its slug`,
  }));
};

/**
 * (i) An engraved open line (T142 on-line operation) must stay inside its part, the tool radius
 * included (T277, D-045): otherwise it cuts into the neighbour part. Error on the line where it
 * is drawn or imported; the toolpath refuses it too (`lineLeavesPart`). The tool is the cutting
 * tool (`validationToolDiameter`); without a profile only the line itself is checked.
 */
export const lineInsidePart: ValidationRule = (project, context) => {
  const radius = validationToolDiameter(project, context) / 2;
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    const lines = part.lines ?? [];
    if (lines.length === 0) return;
    const outline = deriveOutline(part);
    lines.forEach((line, k) => {
      if (line.op.kind !== 'online' || !lineLeavesPart(outline, line.vertices, radius)) return;
      issues.push({
        code: 'LINE_OUTSIDE_PART',
        severity: 'error',
        path: formatPath(['parts', i, 'lines', k]),
        message: `line ${k + 1} of part "${part.name}" leaves the part outline (tool radius ${mm(radius)} mm included)`,
      });
    });
  });
  return issues;
};

/** Rules run after every command, in this order. */
export const VALIDATION_RULES: readonly ValidationRule[] = [
  partLargerThanSheet,
  partNotInLayout,
  holeDepthBelowThickness,
  holeVsTool,
  lockedPlacementInvalid,
  placementGrain,
  noCuttingParams,
  unverifiedCuttingParams,
  spindleRpmOutOfRange,
  feedOutOfRange,
  feedAboveRecommended,
  operationToolUnsuitable,
  marginBelowToolRadius,
  sheetLargerThanTable,
  holeInsidePart,
  innerContourRules,
  innerPocketRules,
  innerSlugTabs,
  lineInsidePart,
];

/** Runs every rule and returns the combined list (errors and warnings, in rule order). */
export function validateProject(
  entered: Project,
  context: ValidationContext = {},
): ValidationIssue[] {
  // T169: geometry is read at cut size (edge-band deduction, spec §4.8).
  const project = toCutSizes(entered);
  return VALIDATION_RULES.flatMap((rule) => rule(project, context));
}

/**
 * The errors that stop the NC export (web `runExport`: every validation error, spec §8.2), with the
 * same context the server uses. T287 / K2: the Simülasyon check badge counts this same list, so
 * the two steps never disagree.
 */
export function exportBlockingIssues(
  project: Project,
  context: ValidationContext = {},
): ValidationIssue[] {
  return validateProject(project, context).filter((i) => i.severity === 'error');
}
