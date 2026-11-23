/**
 * T308 (D-099): which tools of the machine suit an operation of this job. A tool suits when its
 * type fits the operation (`OPERATION_TOOL_TYPES`), its flutes reach the operation's deepest cut,
 * and the job's geometry passes the toolpath's own rules with its diameter: outer contours offset
 * cleanly and the tool is not wider than the one the layout was spaced for (D-019); inner
 * contours keep their corners and slots (`innerContourPath`); every pocket or groove is at least
 * the tool's width; every through hole is at least the tool's diameter, and a drill only drills
 * holes of its own size. The command, the validation and the UI list use the same answer. Pure.
 */
import { EPS } from '../geometry/constants';
import { contour, normalize } from '../geometry/polyline';
import { findMaterialParams, findTool, type MachineProfile, type Tool } from '../machine';
import { nestingToolDiameter } from '../nesting/tool';
import { holeToolProblem } from '../editor/holes';
import { lineLeavesPart } from '../editor/lines';
import type { Project } from '../schema';
import { toCutSizes } from '../schema/cut-size';
import { deriveOutline } from '../schema/outline';
import { innerOperation, outlineOperation } from '../schema/operations';
import { innerContourPath, outerContourPath } from './build';
import { throughCutTarget } from './depth';
import { contourPocketRings } from './contour-pocket';
import {
  OPERATION_TOOL_TYPES,
  hasContourPocket,
  holeToolKind,
  operationToolChoice,
  operationsInJob,
  type OperationToolKind,
} from './op-tools';

export type OperationToolProblem =
  | 'NOT_IN_PROFILE'
  | 'TYPE'
  | 'FLUTE_LENGTH'
  | 'WIDER_THAN_LAYOUT'
  | 'CONTOUR'
  | 'HOLE_SMALLER'
  | 'DRILL_SIZE';

/** Why `toolNo` cannot cut operation `op` of this job, or `null` when it can. */
export function operationToolProblem(
  entered: Project,
  machine: MachineProfile,
  op: OperationToolKind,
  toolNo: number,
): OperationToolProblem | null {
  const tool = findTool(machine, toolNo);
  if (!tool) return 'NOT_IN_PROFILE';
  if (!OPERATION_TOOL_TYPES[op].includes(tool.type)) return 'TYPE';
  const project = toCutSizes(entered);
  const through = -throughCutTarget(project.stock.thickness, machine.zZero.spoilboardAllowance);
  const r = tool.diameter / 2;
  const reach = (depth: number) => depth <= tool.fluteLength + EPS;
  switch (op) {
    case 'outer': {
      if (!reach(through)) return 'FLUTE_LENGTH';
      const spaced = nestingToolDiameter(machine, project.stock);
      if (spaced !== undefined && tool.diameter > spaced + EPS) return 'WIDER_THAN_LAYOUT';
      for (const part of project.parts) {
        const outline = deriveOutline(part);
        const ops = [outlineOperation(part), ...(part.lines ?? []).map((l) => l.op)];
        for (const o of ops) if (o.kind === 'online' && !reach(o.depth)) return 'FLUTE_LENGTH';
        for (const l of part.lines ?? []) {
          if (l.op.kind === 'online' && lineLeavesPart(outline, l.vertices, r)) return 'CONTOUR';
        }
        if (outlineOperation(part).kind !== 'outside') continue;
        const res = outerContourPath(normalize(contour(outline), 'outer'), r);
        if (res.issues.some((i) => i.severity === 'error')) return 'CONTOUR';
      }
      return null;
    }
    case 'inner': {
      if (!reach(through)) return 'FLUTE_LENGTH';
      for (const part of project.parts) {
        for (const [k, inner] of part.inners.entries()) {
          if (innerOperation(part, k).kind !== 'inside') continue;
          const res = innerContourPath(contour(inner), r);
          if (res.issues.some((i) => i.severity === 'error')) return 'CONTOUR';
        }
      }
      return null;
    }
    case 'pocket':
    case 'hole': {
      if (op === 'pocket') {
        // T325: contour pockets need the rings to fit and the flutes to reach their depth.
        for (const part of project.parts) {
          for (const [k, inner] of part.inners.entries()) {
            const o = innerOperation(part, k);
            if (o.kind !== 'pocket') continue;
            if (!reach(o.depth)) return 'FLUTE_LENGTH';
            if (!contourPocketRings(contour(inner), tool.diameter).ok) return 'CONTOUR';
          }
        }
      }
      for (const part of project.parts) {
        for (const h of part.holes) {
          if (holeToolKind(h) !== op) continue;
          const p = holeToolProblem({ ...h, tool: tool.number }, [tool]);
          if (p?.code === 'DRILL_SIZE_MISMATCH') return 'DRILL_SIZE';
          if (p) return 'HOLE_SMALLER';
          if (!reach(h.type === 'through' ? through : h.depth)) return 'FLUTE_LENGTH';
        }
      }
      return null;
    }
  }
}

export interface OperationToolRow {
  op: OperationToolKind;
  /**
   * Default tool: the set's tool for contours; for holes the holes' own tool when they all share
   * one, else `null` ("each hole its own tool").
   */
  defaultTool: number | null;
  /** The project's choice, if any. */
  chosen: number | undefined;
  /** What the job cuts with (`chosen` ?? `defaultTool`). */
  tool: number | null;
  /** Tools that suit the operation, by tool number. The chosen tool is listed even when unsuitable. */
  candidates: Tool[];
  /** Why the chosen tool no longer suits (e.g. a smaller hole drawn after the choice). */
  problem: OperationToolProblem | null;
}

/** One row per operation of the job (see `operationsInJob`); empty without a material set. */
export function operationToolsOf(project: Project, machine: MachineProfile): OperationToolRow[] {
  const set = findMaterialParams(machine, project.stock);
  if (!set) return [];
  return operationsInJob(project).map((op) => {
    let defaultTool: number | null = set.tool;
    if (op === 'pocket' || op === 'hole') {
      const own = new Set(
        project.parts.flatMap((p) =>
          p.holes.filter((h) => holeToolKind(h) === op).map((h) => h.tool),
        ),
      );
      // T325: contour pockets cut with the set's tool by default.
      if (op === 'pocket' && hasContourPocket(project)) own.add(set.tool);
      defaultTool = own.size === 1 ? ([...own][0] as number) : null;
    }
    const chosen = operationToolChoice(project, op);
    const candidates = machine.tools
      .filter(
        (t) => t.number === chosen || operationToolProblem(project, machine, op, t.number) === null,
      )
      .sort((a, b) => a.number - b.number);
    return {
      op,
      defaultTool,
      chosen,
      tool: chosen ?? defaultTool,
      candidates,
      problem: chosen === undefined ? null : operationToolProblem(project, machine, op, chosen),
    };
  });
}
