/**
 * Rule validation (spec §7.3, §5.4, §8.1 step 4). Runs after every command and returns the
 * warning/error list. The schema stays permissive (D-010); rules that need data from more than one
 * place (stock + part, tool table + hole) live here. Pure: same project, same list.
 */
import { bbox, contour, EPS } from '../geometry';
import type { Hole, Part, Project } from '../schema';
import { formatPath } from '../schema';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode = 'PART_LARGER_THAN_SHEET' | 'HOLE_DEPTH_NOT_BELOW_THICKNESS';

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  /** Path into the project JSON, like `parts[0].holes[1].depth`. */
  path: string;
  /** English message; the UI shows a translated text keyed by `code`. */
  message: string;
}

/** A rule inspects the project and returns its issues (possibly none). */
export type ValidationRule = (project: Project) => ValidationIssue[];

/** Width/height of a part's bounding box in its local frame (arc-aware for freeform outlines). */
function partSize(part: Part): { w: number; h: number } {
  if (part.kind === 'rect') return { w: part.params.w, h: part.params.h };
  const box = bbox(contour(part.outline));
  return { w: box.maxX - box.minX, h: box.maxY - box.minY };
}

/** A size for messages: at most 3 decimals (EPS = 0.001 mm), no trailing zeros. */
function mm(v: number): string {
  return String(Number(v.toFixed(3)));
}

/** Fits within EPS: a bbox computed from arcs may overshoot an exact fit by rounding. */
function fits(size: number, room: number): boolean {
  return size <= room + EPS;
}

/**
 * (a) A part that fits on the sheet in no allowed orientation (spec §5.4 "parça plakadan büyük mü").
 * A grain-locked part may only turn 0°/180° (spec §6.2), so w must fit the width and h the height.
 * A free part may also turn 90°. Freeform parts use the arc-aware bbox of their outline (T006).
 * Margin and gap are a nesting concern and are not counted here (T012).
 */
export const partLargerThanSheet: ValidationRule = (project) => {
  const { width, height } = project.stock.sheet;
  const issues: ValidationIssue[] = [];
  project.parts.forEach((part, i) => {
    const size = partSize(part);
    const fitsAsIs = fits(size.w, width) && fits(size.h, height);
    const fitsTurned = !part.grainLock && fits(size.h, width) && fits(size.w, height);
    if (fitsAsIs || fitsTurned) return;
    const how = part.grainLock ? 'grain-locked, no 90° turn' : 'in any orientation';
    issues.push({
      code: 'PART_LARGER_THAN_SHEET',
      severity: 'error',
      path: formatPath(['parts', i, part.kind === 'rect' ? 'params' : 'outline']),
      message: `part "${part.id}" (${mm(size.w)} × ${mm(size.h)} mm) does not fit on the ${width} × ${height} mm sheet (${how})`,
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
 * Rules run after every command, in this order. Tool rules (hole diameter and groove width vs the
 * tool diameter, spec §4.5) arrive with the tool table of the machine profile (T010).
 */
export const VALIDATION_RULES: readonly ValidationRule[] = [
  partLargerThanSheet,
  holeDepthBelowThickness,
];

/** Runs every rule and returns the combined list (errors and warnings, in rule order). */
export function validateProject(project: Project): ValidationIssue[] {
  return VALIDATION_RULES.flatMap((rule) => rule(project));
}
