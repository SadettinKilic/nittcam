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
import { bbox, contour, forEachSegment, normalize } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Polyline } from '../geometry/types';
import {
  deriveOutline,
  innerOperation,
  outlineOperation,
  type Part,
  type Project,
  type Vertex,
} from '../schema';
import {
  holdLimitsOf,
  isSmallPart,
  placedHoleCentre,
  placedInners,
  placedLines,
  placedOutline,
  vGrooveDepth,
  vGrooveRemaining,
  vGrooveTraitsOf,
} from '../toolpath';
import { linePoints } from '../editor/lines';
import type { ExpectedPart } from './types';
import { toFrontCutSizes } from '../schema/cut-size';

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
 * T348: the part as cut from the back face, built here on its own (not with `machinedProject`), so
 * the check compares the program with an independent mirror: every point x → minX + maxX − x in
 * the part frame, arcs reversed. Only what the expectation reads is kept (outline, cut-outs, holes).
 */
function backFacePart(part: Part): Part {
  const outline = deriveOutline(part);
  const box = bbox(contour(outline));
  const sx = box.minX + box.maxX;
  const flip = (vs: readonly Vertex[]): Vertex[] =>
    vs.map((v) => ({ x: sx - v.x, y: v.y, bulge: v.bulge === 0 ? 0 : -v.bulge }));
  const rest = { ...part } as Partial<Part> & { params?: unknown };
  delete rest.params;
  return {
    ...(rest as Part),
    kind: 'freeform',
    outline: normalize(contour(flip(outline)), 'outer').vertices,
    inners: part.inners.map((c) => normalize(contour(flip(c)), 'inner').vertices),
    holes: part.holes.map((h) => ({ ...h, cx: sx - h.cx })),
    // T354: the fold lines too (direction kept, like the machined part).
    ...(part.lines ? { lines: part.lines.map((l) => ({ ...l, vertices: flip(l.vertices) })) } : {}),
  } as Part;
}

/**
 * Parts expected on one sheet (index of `project.layout.sheets`). `toolDiameter`: the cutting
 * tool, for the cut-out loop centres (0 = the openings' own centres).
 */
export function expectedLayout(entered: Project, sheet: number, toolDiameter = 0): ExpectedPart[] {
  // T169: geometry is read at cut size (edge-band deduction, spec §4.8).
  const front = toFrontCutSizes(entered);
  // T348: a back-face stock is cut mirrored; the layout placements are in that machined frame.
  const project =
    entered.stock.machinedFace === 'back'
      ? { ...front, parts: front.parts.map(backFacePart) }
      : front;
  const out: ExpectedPart[] = [];
  // T343: small-part thresholds of the stock's traits row
  const { smallPart } = holdLimitsOf(project.stock.material);
  // T354: fold lines of a material that folds (rule 17).
  const vTraits = vGrooveTraitsOf(project.stock.material);
  const depthOf = (op: { kind: string; remaining?: number | undefined }) =>
    vGrooveDepth(
      project.stock.thickness,
      vGrooveRemaining(
        { kind: 'vgroove', ...(op.remaining === undefined ? {} : { remaining: op.remaining }) },
        vTraits,
      ),
    );
  for (const pl of project.layout.sheets[sheet]?.placements ?? []) {
    const part = project.parts.find((p) => p.id === pl.partId);
    if (!part) continue;
    const outline = placedOutline(part, pl);
    out.push({
      partId: pl.partId,
      copy: pl.index,
      ...centre(outline),
      // T338 (D-129): the outline and small/skin flags for the hold rule (PART_NOT_HELD)
      outline: polygonOf(outline),
      small: isSmallPart(outline, smallPart.area, smallPart.minSide),
      skin: project.cutting.skin !== undefined,
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
      ...(vTraits ? grooveField(part, pl, depthOf) : {}),
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

/** T354: the placed fold lines of a part, sampled in the sheet frame, with their depths. */
function grooveField(
  part: Part,
  pl: Parameters<typeof placedOutline>[1],
  depthOf: (op: { kind: string; remaining?: number | undefined }) => number,
): Pick<ExpectedPart, 'grooves'> {
  const grooves: NonNullable<ExpectedPart['grooves']>[number][] = [];
  placedInners(part, pl).forEach((c, k) => {
    const op = innerOperation(part, k);
    if (op.kind !== 'vgroove') return;
    const ring = [...c.vertices, { ...(c.vertices[0] as Vertex), bulge: 0 }];
    grooves.push({ id: `inner${k}`, line: linePoints(ring), depth: depthOf(op) });
  });
  placedLines(part, pl).forEach((l, k) => {
    if (l.op.kind !== 'vgroove') return;
    grooves.push({ id: `line${k}`, line: linePoints(l.poly.vertices), depth: depthOf(l.op) });
  });
  return grooves.length > 0 ? { grooves } : {};
}

/** `expectedLayout` for every sheet of the project. */
export function expectedLayouts(project: Project, toolDiameter = 0): Map<number, ExpectedPart[]> {
  const m = new Map<number, ExpectedPart[]>();
  project.layout.sheets.forEach((_, i) => m.set(i, expectedLayout(project, i, toolDiameter)));
  return m;
}
