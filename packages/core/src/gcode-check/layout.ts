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
import { bbox, forEachSegment, normalize } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Polyline } from '../geometry/types';
import { innerOperation, outlineOperation, type Project } from '../schema';
import { placedHoleCentre, placedInners, placedOutline } from '../toolpath';
import type { ExpectedPart } from './types';
import { toCutSizes } from '../schema/cut-size';

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

/** A closed contour as a polygon: arcs sampled every ≤ 0.01 rad (chord error ≤ 1.25e-5 · radius). */
function polygonOf(pl: Polyline): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  forEachSegment(pl, (a, b, bulge) => {
    const steps = Math.min(4000, Math.max(1, Math.ceil(Math.abs(4 * Math.atan(bulge)) / 0.01)));
    out.push(...sampleSegment(a, b, bulge, steps).slice(0, -1));
  });
  return out;
}

/**
 * Parts expected on one sheet (index of `project.layout.sheets`). `toolDiameter`: the cutting
 * tool, for the cut-out loop centres (0 = the openings' own centres).
 */
export function expectedLayout(entered: Project, sheet: number, toolDiameter = 0): ExpectedPart[] {
  // T169: geometry is read at cut size (edge-band deduction, spec §4.8).
  const project = toCutSizes(entered);
  const out: ExpectedPart[] = [];
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const part = project.parts.find((p) => p.id === pl.partId);
    if (!part) continue;
    out.push({
      partId: pl.partId,
      copy: pl.index,
      ...centre(placedOutline(part, pl)),
      // T142: only through cuts are closed loops at the target depth.
      ...(outlineOperation(part).kind === 'outside' ? {} : { outlineCut: false }),
      inners: placedInners(part, pl)
        .map((c, k) => ({ c, k }))
        .filter(({ k }) => innerOperation(part, k).kind === 'inside')
        .map(({ c }) => innerCentre(c, toolDiameter / 2)),
      // T325: blind contour pockets, with their boundary and declared depth.
      pockets: placedInners(part, pl).flatMap((c, k) => {
        const op = innerOperation(part, k);
        return op.kind === 'pocket' ? [{ inner: k, boundary: polygonOf(c), depth: op.depth }] : [];
      }),
      holes: part.holes
        .filter((h) => h.type === 'through')
        .map((h) => {
          const c = placedHoleCentre(part, pl, h);
          return { cx: c.x, cy: c.y };
        }),
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
