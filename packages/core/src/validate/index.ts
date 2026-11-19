/**
 * Rule validation (spec §7.3, §5.4, §8.1 step 4). Runs after every command and returns the
 * warning/error list. The schema stays permissive (D-010); rules that need data from more than one
 * place (stock + part, tool table + hole) live here. Pure: same project, same list.
 */
import { EPS } from '../geometry';
import { findMaterialParams, findTool, type MachineProfile } from '../machine';
import { allowedRotations, rotationAllowed } from '../geometry/grain';
import { fitsUsableAny, partBoxSize, partShape, rotationOptions, usableSize } from '../nesting/fit';
import { checkPlacement, partSizes } from '../nesting/placement';
import { nestingToolDiameter } from '../nesting/tool';
import type { Hole, Project } from '../schema';
import { deriveOutline, formatPath } from '../schema';
import { checkHolePlacement } from '../editor/holes';
import { checkInnerContour, innerFitsTool } from '../editor/inners';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'PART_LARGER_THAN_SHEET'
  | 'HOLE_DEPTH_NOT_BELOW_THICKNESS'
  | 'HOLE_DEPTH_NEAR_THICKNESS'
  | 'TOOL_NOT_IN_PROFILE'
  | 'HOLE_SMALLER_THAN_TOOL'
  | 'GROOVE_NARROWER_THAN_TOOL'
  | 'LOCKED_PLACEMENT_INVALID'
  | 'LOCKED_PLACEMENT_GRAIN'
  | 'PLACEMENT_GRAIN'
  | 'NO_CUTTING_PARAMS'
  | 'CUTTING_PARAMS_UNVERIFIED'
  | 'SHEET_LARGER_THAN_TABLE'
  | 'HOLE_OUTSIDE_PART'
  | 'INNER_CONTOUR_INVALID'
  | 'INNER_CONTOUR_TOO_SMALL';

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
  const { width, height } = project.stock.sheet;
  const { margin } = project.nesting;
  const usable = usableSize(project.stock.sheet, margin);
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    const size = partBoxSize(part);
    // The forced grain rotation counts (D-034): the same footprints the placer tries.
    const rotations = allowedRotations(part, project.stock.sheet);
    if (fitsUsableAny(rotationOptions(partShape(part), rotations), usable)) return;
    const locked = part.grain.mode === 'fixed' && project.stock.sheet.grain !== null;
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
      if (hole.depth < thickness) {
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
 *   `grooveWidth < tool diameter` is a warning.
 * Comparisons allow EPS, so a hole within 0.001 mm of the tool diameter counts as equal.
 * Skipped when the caller passes no profile.
 */
export const holeVsTool: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine) return [];
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    part.holes.forEach((hole, h) => {
      const tool = findTool(machine, hole.tool);
      if (!tool) {
        issues.push({
          code: 'TOOL_NOT_IN_PROFILE',
          severity: 'error',
          path: formatPath(['parts', i, 'holes', h, 'tool']),
          message: `${hole.type} "${hole.id}" in part "${part.id}" uses tool T${hole.tool}, which is not in the machine's tool table`,
        });
        return;
      }
      if (hole.type === 'groove') {
        if (hole.grooveWidth + EPS < tool.diameter) {
          issues.push({
            code: 'GROOVE_NARROWER_THAN_TOOL',
            severity: 'warning',
            path: formatPath(['parts', i, 'holes', h, 'grooveWidth']),
            message: `groove "${hole.id}" in part "${part.id}" is ${mm(hole.grooveWidth)} mm wide, narrower than the ${mm(tool.diameter)} mm tool T${tool.number}`,
          });
        }
        return;
      }
      if (hole.d + EPS < tool.diameter) {
        issues.push({
          code: 'HOLE_SMALLER_THAN_TOOL',
          severity: 'error',
          path: formatPath(['parts', i, 'holes', h, 'd']),
          message: `${hole.type} "${hole.id}" in part "${part.id}" is ${mm(hole.d)} mm, smaller than the ${mm(tool.diameter)} mm tool T${tool.number}`,
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
  const issues: ValidationIssue[] = [];
  project.layout.sheets.forEach((sheet, s) => {
    sheet.placements.forEach((pl, p) => {
      if (!pl.locked || !sizes.has(pl.partId)) return;
      const check = checkPlacement(project, s, pl, { toolDiameter }, sizes);
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
      if (!part || rotationAllowed(part, project.stock.sheet, pl.rot)) return;
      const allowed = allowedRotations(part, project.stock.sheet);
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
 * (f) The sheet does not fit the machine table at its place (`origin.sheetOffset`), spec §3.6
 * "Plaka tablaya sığmıyorsa uyarı". A warning here; the automatic G-code check blocks the export
 * (`SHEET_OUTSIDE_TABLE`, D-027). EPS slack. Skipped without a profile.
 */
export const sheetLargerThanTable: ValidationRule = (project, context) => {
  const machine = context?.machine;
  if (!machine) return [];
  const { width, height } = project.stock.sheet;
  const off = machine.origin.sheetOffset;
  const fits =
    off.x + width <= machine.table.width + EPS && off.y + height <= machine.table.depth + EPS;
  if (fits) return [];
  return [
    {
      code: 'SHEET_LARGER_THAN_TABLE',
      severity: 'warning',
      path: 'stock.sheet',
      message: `the ${mm(width)} × ${mm(height)} mm sheet does not fit the ${mm(machine.table.width)} × ${mm(machine.table.depth)} mm table`,
    },
  ];
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
  const tool = machine && params ? findTool(machine, params.tool) : undefined;
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
      } else if (tool && !innerFitsTool(inner, tool.diameter)) {
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

/** Rules run after every command, in this order. */
export const VALIDATION_RULES: readonly ValidationRule[] = [
  partLargerThanSheet,
  holeDepthBelowThickness,
  holeVsTool,
  lockedPlacementInvalid,
  placementGrain,
  noCuttingParams,
  unverifiedCuttingParams,
  sheetLargerThanTable,
  holeInsidePart,
  innerContourRules,
];

/** Runs every rule and returns the combined list (errors and warnings, in rule order). */
export function validateProject(
  project: Project,
  context: ValidationContext = {},
): ValidationIssue[] {
  return VALIDATION_RULES.flatMap((rule) => rule(project, context));
}
