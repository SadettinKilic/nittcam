/**
 * V-groove (fold groove) of a composite panel (T352, T353; spec §6.3 "V-kanal", analysis §4.5).
 *
 * A V-groove is a fold line: an open line or inner contour of the part (part frame, the same
 * vertices the fold preview of the assembly bench reads later), cut along its centre with a V-bit
 * from the machined face so that `remaining` mm of the far face stays. Everything a fold needs is
 * readable from the project and the machine: the line (`vGrooveLines`), the remaining skin
 * (`vGrooveRemaining`), the depth (`vGrooveDepth`), the V angle and tip of the V-bit
 * (`vGrooveTool`) and the open width on the machined face (`vGrooveWidth`). Pure.
 */
import { EPS } from '../geometry/constants';
import type { Vertex } from '../geometry/types';
import { findTool, materialKindOf, type MachineProfile, type Tool } from '../machine';
import { traitsOf, type MaterialTraits } from '../machine/material-traits';
import type { ContourOperation, Part, Project } from '../schema';
import { innerOperation } from '../schema/operations';

export type VGrooveTraits = NonNullable<MaterialTraits['vGroove']>;

/** The stock material's V-groove row, or `null` where the kind has no V-groove. */
export function vGrooveTraitsOf(material: string): VGrooveTraits | null {
  return traitsOf(materialKindOf(material)).vGroove;
}

/** Remaining skin of a groove, mm: its own value, else the traits default (0,8 mm on ACM). */
export function vGrooveRemaining(
  op: Extract<ContourOperation, { kind: 'vgroove' }>,
  traits: VGrooveTraits | null,
): number {
  return op.remaining ?? traits?.defaultRemaining ?? 0;
}

/** Groove depth from the machined face, mm (= thickness − remaining). */
export function vGrooveDepth(thickness: number, remaining: number): number {
  return Math.round((thickness - remaining) * 1e6) / 1e6;
}

/** Whether a tool has the V geometry a groove needs (a V-bit with its included angle). */
export function hasVGeometry(tool: Tool): boolean {
  return tool.type === 'vBit' && tool.angleDeg !== undefined;
}

/**
 * Open width of the groove on the machined face, mm: tip flat + 2 · depth · tan(angle / 2). The
 * tool's Z zero is its flat tip, so the tip flat adds to the width and not to the depth.
 */
export function vGrooveWidth(tool: Pick<Tool, 'angleDeg' | 'tipDiameter'>, depth: number): number {
  const half = (((tool.angleDeg ?? 90) / 2) * Math.PI) / 180;
  return (tool.tipDiameter ?? 0) + 2 * Math.max(0, depth) * Math.tan(half);
}

/** Deepest groove the V-bit's cone can cut before its full diameter is reached, mm. */
export function vConeDepth(tool: Pick<Tool, 'angleDeg' | 'tipDiameter' | 'diameter'>): number {
  const half = (((tool.angleDeg ?? 90) / 2) * Math.PI) / 180;
  return (tool.diameter - (tool.tipDiameter ?? 0)) / (2 * Math.tan(half));
}

/** Pass depths (negative Z) of a groove: one pass, or n even passes when deeper than `step`. */
export function vGroovePassDepths(depth: number, step: number): number[] {
  const n = Math.max(1, Math.ceil(depth / step - EPS));
  return Array.from({ length: n }, (_, i) => -Math.round(((depth * (i + 1)) / n) * 1e6) / 1e6);
}

export interface VGrooveLine {
  /** `inner` = inner contour (closed), `line` = open line. */
  type: 'inner' | 'line';
  index: number;
  closed: boolean;
  vertices: readonly Vertex[];
  remaining: number;
}

/** Every V-groove of a part (part frame), with its effective remaining skin. */
export function vGrooveLines(part: Part, traits: VGrooveTraits | null): VGrooveLine[] {
  const out: VGrooveLine[] = [];
  part.inners.forEach((inner, k) => {
    const op = innerOperation(part, k);
    if (op.kind !== 'vgroove') return;
    out.push({
      type: 'inner',
      index: k,
      closed: true,
      vertices: inner,
      remaining: vGrooveRemaining(op, traits),
    });
  });
  (part.lines ?? []).forEach((l, k) => {
    if (l.op.kind !== 'vgroove') return;
    out.push({
      type: 'line',
      index: k,
      closed: false,
      vertices: l.vertices,
      remaining: vGrooveRemaining(l.op, traits),
    });
  });
  return out;
}

/** Deepest groove of the job, mm (0 without grooves). */
export function deepestVGroove(project: Project): number {
  const traits = vGrooveTraitsOf(project.stock.material);
  let deepest = 0;
  for (const p of project.parts) {
    for (const g of vGrooveLines(p, traits)) {
      deepest = Math.max(deepest, vGrooveDepth(project.stock.thickness, g.remaining));
    }
  }
  return deepest;
}

/**
 * Why a remaining skin is not allowed on this stock, or `null`: the traits bounds (0,7 … 1,2 mm on
 * ACM) and below the thickness.
 */
export function vGrooveRemainingProblem(
  remaining: number,
  thickness: number,
  traits: VGrooveTraits,
): string | null {
  if (remaining < traits.minRemaining - EPS) {
    return `remaining ${remaining} mm is below the minimum ${traits.minRemaining} mm (the front face would be cut)`;
  }
  if (remaining > traits.maxRemaining + EPS) {
    return `remaining ${remaining} mm is above the maximum ${traits.maxRemaining} mm (the panel would not fold)`;
  }
  if (!(remaining < thickness - EPS)) {
    return `remaining ${remaining} mm must be less than the thickness (${thickness} mm)`;
  }
  return null;
}

/**
 * The V-bit the grooves are cut with: the project's choice (`cutting.tools.vgroove`), else the
 * machine's lowest-numbered V-bit with an angle. `undefined` = no V-bit (VGROOVE_TOOL_MISSING).
 */
export function vGrooveToolOf(project: Project, machine: MachineProfile): Tool | undefined {
  const chosen = project.cutting.tools?.vgroove;
  if (chosen !== undefined) return findTool(machine, chosen);
  return [...machine.tools].sort((a, b) => a.number - b.number).find(hasVGeometry);
}
