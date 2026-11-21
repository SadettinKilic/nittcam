/**
 * T308 (D-099): the cutting tool of each operation of a job. By default the outer and inner
 * contours cut with the material set's tool and every pocket or through hole with its own tool
 * (what the toolpath has always done). A project may choose one tool per operation
 * (`project.cutting.tools`, command `setOperationTool`); the toolpath, the spindle rows (T307) and
 * the program read the choice. Suitability against the job's geometry lives in `op-tool-choice`.
 * Pure.
 */
import type { MachineProfile, MaterialParams, ToolType } from '../machine';
import { materialKindOf } from '../machine/material';
import { innerOperation } from '../schema/operations';
import type { Hole, Project } from '../schema';

export const OPERATION_TOOL_KINDS = ['outer', 'inner', 'pocket', 'hole'] as const;
export type OperationToolKind = (typeof OPERATION_TOOL_KINDS)[number];

/** Tool types an operation may cut with: contours and pockets end mills, through holes also a drill. */
export const OPERATION_TOOL_TYPES: Record<OperationToolKind, readonly ToolType[]> = {
  outer: ['flatEndMill', 'compression'],
  inner: ['flatEndMill', 'compression'],
  pocket: ['flatEndMill', 'compression'],
  hole: ['drill', 'flatEndMill'],
};

/**
 * The project's own tool for an operation, if any. A choice left for an operation the job does
 * not have (e.g. `inner` after the last inner contour was removed) is ignored everywhere (toolpath,
 * validation, spindle rows, header) and comes back into use when the operation does.
 */
export function operationToolChoice(project: Project, op: OperationToolKind): number | undefined {
  const tool = project.cutting.tools?.[op];
  if (tool === undefined) return undefined;
  return operationsInJob(project).includes(op) ? tool : undefined;
}

/** The operation a hole belongs to: through holes = `hole`, blind pockets and grooves = `pocket`. */
export function holeToolKind(hole: Pick<Hole, 'type'>): 'pocket' | 'hole' {
  return hole.type === 'through' ? 'hole' : 'pocket';
}

/** The tool a hole is cut with: the project's choice for its operation, else the hole's own tool. */
export function effectiveHoleTool(project: Project, hole: Pick<Hole, 'type' | 'tool'>): number {
  return operationToolChoice(project, holeToolKind(hole)) ?? hole.tool;
}

/** The tool a contour operation is cut with: the project's choice, else `base` (the set's tool). */
export function contourTool<T extends number | undefined>(
  project: Project,
  op: 'outer' | 'inner',
  base: T,
): number | T {
  return operationToolChoice(project, op) ?? base;
}

/** Whether any part has an inner contour cut through inside its line (the `inner` operation). */
export function hasInnerCut(project: Project): boolean {
  return project.parts.some((p) => p.inners.some((_, k) => innerOperation(p, k).kind === 'inside'));
}

/** Operations the job has, in display order (outer always: every job cuts its outlines). */
export function operationsInJob(project: Project): OperationToolKind[] {
  const out: OperationToolKind[] = ['outer'];
  if (hasInnerCut(project)) out.push('inner');
  const holes = project.parts.flatMap((p) => p.holes);
  if (holes.some((h) => holeToolKind(h) === 'pocket')) out.push('pocket');
  if (holes.some((h) => holeToolKind(h) === 'hole')) out.push('hole');
  return out;
}

/** Tools chosen by the project for an operation that differ from the set's tool. */
function chosenTools(project: Project, set: MaterialParams): Set<number> {
  const out = new Set<number>();
  for (const op of OPERATION_TOOL_KINDS) {
    const n = operationToolChoice(project, op);
    if (n !== undefined && n !== set.tool) out.add(n);
  }
  return out;
}

/**
 * T308 + T307: the recommended spindle speed of a job tool. The set's own tool and every tool the
 * project did not choose (hole tools by default) get the set's rpm, as before. A tool the project
 * chose for an operation takes the rpm of the machine's set of the same material that names it
 * (nearest thickness, the thinner on a tie); without one, the job set's rpm.
 */
export function recommendedRpm(
  project: Project,
  machine: Pick<MachineProfile, 'materials'>,
  set: MaterialParams,
  tool: number,
): number {
  if (tool === set.tool || !chosenTools(project, set).has(tool)) return set.rpm;
  const kind = materialKindOf(project.stock.material);
  const own = machine.materials
    .filter((m) => m.material === kind && m.tool === tool && !m.unverified)
    .sort(
      (a, b) =>
        Math.abs(a.thickness - project.stock.thickness) -
          Math.abs(b.thickness - project.stock.thickness) || a.thickness - b.thickness,
    )[0];
  return own?.rpm ?? set.rpm;
}
