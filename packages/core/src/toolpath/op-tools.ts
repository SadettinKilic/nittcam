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
import { traitsOf } from '../machine/material-traits';
import { innerOperation } from '../schema/operations';
import type { Hole, Project } from '../schema';

export const OPERATION_TOOL_KINDS = ['outer', 'inner', 'pocket', 'hole'] as const;
export type OperationToolKind = (typeof OPERATION_TOOL_KINDS)[number];

/**
 * Tool types an operation may cut with on today's kinds: contours and pockets end mills, through
 * holes also a drill. Code that knows the stock reads `operationToolTypes` (T344).
 */
export const OPERATION_TOOL_TYPES: Record<OperationToolKind, readonly ToolType[]> = {
  outer: ['flatEndMill', 'compression'],
  inner: ['flatEndMill', 'compression'],
  pocket: ['flatEndMill', 'compression'],
  hole: ['drill', 'flatEndMill'],
};

/**
 * T344: the tool types each operation may cut with on a stock material (its traits row); the six
 * kinds of today and an unknown material give `OPERATION_TOOL_TYPES`.
 */
export function operationToolTypes(
  material: string,
): Readonly<Record<OperationToolKind, readonly ToolType[]>> {
  return traitsOf(materialKindOf(material)).toolTypes;
}

/** Whether a tool type may cut operation `op` on the stock material (T344). */
export function toolTypeAllowed(material: string, op: OperationToolKind, type: ToolType): boolean {
  return operationToolTypes(material)[op].includes(type);
}

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

/** Whether any part has an inner contour cleared as a blind pocket (T325, the `pocket` operation). */
export function hasContourPocket(project: Project): boolean {
  return project.parts.some((p) => p.inners.some((_, k) => innerOperation(p, k).kind === 'pocket'));
}

/**
 * The tool a contour pocket (T325) is cut with: the project's choice for the `pocket` operation,
 * else `base` (the set's tool, like the inner contours).
 */
export function contourPocketTool<T extends number | undefined>(
  project: Project,
  base: T,
): number | T {
  return operationToolChoice(project, 'pocket') ?? base;
}

/** Operations the job has, in display order (outer always: every job cuts its outlines). */
export function operationsInJob(project: Project): OperationToolKind[] {
  const out: OperationToolKind[] = ['outer'];
  if (hasInnerCut(project)) out.push('inner');
  const holes = project.parts.flatMap((p) => p.holes);
  if (holes.some((h) => holeToolKind(h) === 'pocket') || hasContourPocket(project)) {
    out.push('pocket');
  }
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
 * The machine's set of the job's material that names `tool` (nearest thickness, the thinner on a
 * tie), for a tool the project chose for an operation; else the job set. The set's own tool and
 * every tool the project did not choose (hole tools by default) use the job set, as before.
 */
function recommendationSet(
  project: Project,
  machine: Pick<MachineProfile, 'materials'>,
  set: MaterialParams,
  tool: number,
): MaterialParams {
  if (tool === set.tool || !chosenTools(project, set).has(tool)) return set;
  const kind = materialKindOf(project.stock.material);
  const own = machine.materials
    .filter((m) => m.material === kind && m.tool === tool && !m.unverified)
    .sort(
      (a, b) =>
        Math.abs(a.thickness - project.stock.thickness) -
          Math.abs(b.thickness - project.stock.thickness) || a.thickness - b.thickness,
    )[0];
  return own ?? set;
}

/**
 * T308 + T307: the recommended spindle speed of a job tool: the rpm of its recommendation set
 * (the job set, or for a tool the project chose, that tool's own set of the same material).
 */
export function recommendedRpm(
  project: Project,
  machine: Pick<MachineProfile, 'materials'>,
  set: MaterialParams,
  tool: number,
): number {
  return recommendationSet(project, machine, set, tool).rpm;
}

/** T323: the recommended cutting and plunge feed of a job tool, from the same set as its rpm. */
export function recommendedFeeds(
  project: Project,
  machine: Pick<MachineProfile, 'materials'>,
  set: MaterialParams,
  tool: number,
): { feed: number; plungeFeed: number } {
  const own = recommendationSet(project, machine, set, tool);
  return { feed: own.feed, plungeFeed: own.plungeFeed };
}
