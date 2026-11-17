/**
 * Expected part positions from the layout (T019, D-027): the centre of each placed outline's
 * bounding box in the sheet frame. Uses the toolpath layer's `placedOutline` (D-019), the same
 * definition the model is built from, as the expected reference.
 */
import { bbox } from '../geometry/polyline';
import type { Project } from '../schema';
import { placedOutline } from '../toolpath';
import type { ExpectedPart } from './types';

/** Parts expected on one sheet (index of `project.layout.sheets`). */
export function expectedLayout(project: Project, sheet: number): ExpectedPart[] {
  const out: ExpectedPart[] = [];
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const part = project.parts.find((p) => p.id === pl.partId);
    if (!part) continue;
    const box = bbox(placedOutline(part, pl));
    out.push({
      partId: pl.partId,
      copy: pl.index,
      cx: (box.minX + box.maxX) / 2,
      cy: (box.minY + box.maxY) / 2,
    });
  }
  return out;
}

/** `expectedLayout` for every sheet of the project. */
export function expectedLayouts(project: Project): Map<number, ExpectedPart[]> {
  const m = new Map<number, ExpectedPart[]>();
  project.layout.sheets.forEach((_, i) => m.set(i, expectedLayout(project, i)));
  return m;
}
