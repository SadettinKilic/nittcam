import type { Project } from '../schema/project';

/**
 * Part number of one copy (T171, spec §2.4): "row.copy", the cut-list row and the copy number,
 * both from 1. The one rule for the layout view, simulation, 3D preview, PDF and labels.
 */
export function partNumber(row: number, copy: number): string {
  return `${row}.${copy}`;
}

/** Part number of a placement (`index` from 0) in `project`, or null for an unknown part. */
export function placementNumber(
  project: Pick<Project, 'parts'>,
  ref: { partId: string; index: number },
): string | null {
  const row = project.parts.findIndex((p) => p.id === ref.partId);
  return row < 0 ? null : partNumber(row + 1, ref.index + 1);
}
