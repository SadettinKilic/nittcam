/**
 * Drawn items of a part that a blocking issue can point at (T270 cut-outs, T275 holes), shared by
 * the Simülasyon and Dışa aktar boxes. Framework-free so the rule is unit-tested.
 */
import type { Project, ValidationIssue } from '@nittcam/core';

/** Hole errors whose fix may be on the machine (add the tool / a smaller tool), T275. */
const MACHINE_FIXABLE_HOLE_CODES: ReadonlySet<string> = new Set([
  'TOOL_NOT_IN_PROFILE',
  'HOLE_SMALLER_THAN_TOOL',
  'GROOVE_NARROWER_THAN_TOOL',
]);

export interface ItemRef {
  code: string;
  partId?: string | undefined;
  inner?: number | undefined;
  hole?: number | undefined;
}

/** The issue names a drawn cut-out or hole of a part ("Çizimde aç" applies). */
export function onDrawnItem(f: ItemRef): boolean {
  return f.partId !== undefined && (f.inner !== undefined || f.hole !== undefined);
}

/**
 * Whether the "Makineler sayfası" link belongs to this issue: every issue that is not about a drawn
 * item, plus hole errors the machine's tool table can fix (D-045: a second link, never the only way).
 */
export function machineRelated(f: ItemRef): boolean {
  if (f.inner !== undefined) return false;
  if (f.hole !== undefined) return MACHINE_FIXABLE_HOLE_CODES.has(f.code);
  return true;
}

/** "Kapak · İç kesim 3" / "Kapak · Delik 3" for an issue about a drawn item of a known part. */
export function itemPlace(
  f: ItemRef,
  parts: readonly { id: string; name: string }[] | undefined,
  text: { innerPlace: string; holePlace: string },
  fill: (template: string, values: Record<string, string | number>) => string,
): string | null {
  if (f.partId === undefined) return null;
  const name = parts?.find((p) => p.id === f.partId)?.name;
  if (!name) return null;
  if (f.inner !== undefined) return fill(text.innerPlace, { name, n: f.inner + 1 });
  if (f.hole !== undefined) return fill(text.holePlace, { name, n: f.hole + 1 });
  return null;
}

/**
 * T275 (B13a pattern, D-045): the blocking errors of each hole (`parts[i].holes[h]...` paths: tool
 * missing, smaller than the tool, groove narrower than the tool, blind depth ≥ thickness, outside
 * the part), by part id and hole index. Same core rule as the toolpath (`holeToolProblem`).
 */
export function holeErrors(
  project: Project,
  issues: readonly ValidationIssue[],
): Map<string, Map<number, ValidationIssue[]>> {
  const out = new Map<string, Map<number, ValidationIssue[]>>();
  for (const i of issues) {
    if (i.severity !== 'error') continue;
    const m = /^parts\[(\d+)\]\.holes\[(\d+)\]/.exec(i.path);
    const part = m ? project.parts[Number(m[1])] : undefined;
    if (!m || !part) continue;
    const byHole = out.get(part.id) ?? new Map<number, ValidationIssue[]>();
    const h = Number(m[2]);
    byHole.set(h, [...(byHole.get(h) ?? []), i]);
    out.set(part.id, byHole);
  }
  return out;
}
