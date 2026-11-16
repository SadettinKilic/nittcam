/**
 * Rule validation (spec §7.3, §5.4, §8.1 step 4). Runs after every command and returns the
 * warning/error list. The schema stays permissive (D-010); rules that need data from more than one
 * place (stock + part, tool table + hole) live here. Pure: same project, same list.
 */
import { EPS } from '../geometry';
import { findTool, type MachineProfile } from '../machine';
import { fitsUsable, partBoxSize, usableSize } from '../nesting/fit';
import type { Hole, Project } from '../schema';
import { formatPath } from '../schema';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'PART_LARGER_THAN_SHEET'
  | 'HOLE_DEPTH_NOT_BELOW_THICKNESS'
  | 'TOOL_NOT_IN_PROFILE'
  | 'HOLE_SMALLER_THAN_TOOL'
  | 'GROOVE_NARROWER_THAN_TOOL';

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
 * `TOO_LARGE`. A grain-locked part may only turn 0°/180° (spec §6.2), so w must fit the width and
 * h the height; a free part may also turn 90°. Freeform parts use the arc-aware bbox of their
 * outline (T006). The gap and tool diameter only matter between parts and are not counted.
 */
export const partLargerThanSheet: ValidationRule = (project) => {
  const { width, height } = project.stock.sheet;
  const { margin } = project.nesting;
  const usable = usableSize(project.stock.sheet, margin);
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    const size = partBoxSize(part);
    if (fitsUsable(size.w, size.h, part.grainLock, usable)) return;
    const how = part.grainLock ? 'grain-locked, no 90° turn' : 'in any orientation';
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

function isBlind(hole: Hole): hole is Extract<Hole, { depth: number }> {
  return hole.type === 'pocket' || hole.type === 'groove';
}

/**
 * (b) Blind depth must be smaller than the stock thickness (spec §4.5 "Kör derinlik malzeme
 * kalınlığından küçük olmalı"). Applies to pockets and grooves, the two hole types with a depth.
 * The "too close" warning of §4.5 needs a threshold the spec does not give yet (open question).
 */
export const holeDepthBelowThickness: ValidationRule = (project) => {
  const { thickness } = project.stock;
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    part.holes.forEach((hole, h) => {
      if (!isBlind(hole) || hole.depth < thickness) return;
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

/** Rules run after every command, in this order. */
export const VALIDATION_RULES: readonly ValidationRule[] = [
  partLargerThanSheet,
  holeDepthBelowThickness,
  holeVsTool,
];

/** Runs every rule and returns the combined list (errors and warnings, in rule order). */
export function validateProject(
  project: Project,
  context: ValidationContext = {},
): ValidationIssue[] {
  return VALIDATION_RULES.flatMap((rule) => rule(project, context));
}
