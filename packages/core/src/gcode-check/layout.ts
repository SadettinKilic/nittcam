/**
 * Expected part positions from the layout (T019, D-027): the centre of each placed outline's
 * bounding box in the sheet frame. Uses the toolpath layer's `placedOutline` / `placedInners`
 * (D-019), the same definition the model is built from, as the expected reference.
 *
 * Inner contours (T134): every cut-out of a placed copy is a closed through cut of its own, so it
 * is expected too, at the centre of its tool-centre loop (the cut-out offset inward by the tool
 * radius; for a symmetric opening that is the opening's own box centre). The cut-outs turn and
 * move with the copy.
 */
import { offset } from '../geometry/offset';
import { bbox, normalize } from '../geometry/polyline';
import type { Polyline } from '../geometry/types';
import type { Project } from '../schema';
import { placedInners, placedOutline } from '../toolpath';
import type { ExpectedPart } from './types';

function centre(pl: Polyline): { cx: number; cy: number } {
  const box = bbox(pl);
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2 };
}

/** Centre of a cut-out's tool-centre loop; the opening's own centre when it cannot be offset. */
function innerCentre(inner: Polyline, toolRadius: number): { cx: number; cy: number } {
  if (toolRadius > 0) {
    const res = offset(normalize(inner, 'inner'), toolRadius);
    const only = res.ok && res.polylines.length === 1 ? res.polylines[0] : undefined;
    if (only) return centre(only);
  }
  return centre(inner);
}

/**
 * Parts expected on one sheet (index of `project.layout.sheets`). `toolDiameter`: the cutting
 * tool, for the cut-out loop centres (0 = the openings' own centres).
 */
export function expectedLayout(project: Project, sheet: number, toolDiameter = 0): ExpectedPart[] {
  const out: ExpectedPart[] = [];
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const part = project.parts.find((p) => p.id === pl.partId);
    if (!part) continue;
    out.push({
      partId: pl.partId,
      copy: pl.index,
      ...centre(placedOutline(part, pl)),
      inners: placedInners(part, pl).map((c) => innerCentre(c, toolDiameter / 2)),
    });
  }
  return out;
}

/** `expectedLayout` for every sheet of the project. */
export function expectedLayouts(project: Project, toolDiameter = 0): Map<number, ExpectedPart[]> {
  const m = new Map<number, ExpectedPart[]>();
  project.layout.sheets.forEach((_, i) => m.set(i, expectedLayout(project, i, toolDiameter)));
  return m;
}
