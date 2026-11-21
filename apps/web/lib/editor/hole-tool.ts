/**
 * Hole tool of the drawing board (T138, spec §4.5): click the centre on a part, the diameter
 * grows live with the cursor, the second click adds the hole (one `addHole`). Pure helpers; the
 * board keeps the in-progress centre as UI state.
 */
import {
  bestHoleTool,
  boardPositions,
  checkHolePlacement,
  contourDistance,
  deriveOutline,
  holeSchema,
  holeToolProblem,
  insideContour,
  type BoardPart,
  type Hole,
  type HolePlacementError,
  type HoleRuleTool,
  type Part,
  type Project,
} from '@nittcam/core';
import { hitPart } from './hit';
import type { Pt } from './viewport';

/** In-progress hole: the part it belongs to and its centre in board mm. */
export interface HoleDraft {
  partId: string;
  c: Pt;
}

/** Live diameter from centre to cursor, to 0.1 mm, never below the tool diameter. */
export function liveDiameter(c: Pt, cursor: Pt, toolDiameter: number): number {
  const d = Math.round(2 * Math.hypot(cursor.x - c.x, cursor.y - c.y) * 10) / 10;
  return Math.max(d, toolDiameter);
}

/** Next free hole id of a part: h1, h2, … */
export function nextHoleId(part: Pick<Part, 'holes'>): string {
  const taken = new Set(part.holes.map((h) => h.id));
  let n = part.holes.length + 1;
  while (taken.has(`h${n}`)) n++;
  return `h${n}`;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * `addHole` params for a hole drawn on the board: a through hole (the simplest valid type; the
 * properties panel turns it into a pocket or a groove) in the part frame. B52 (D-096, "aynı
 * değerlerle devam"): with `like` (the last hole added), the new hole copies its type, depth,
 * groove width and tool; a copy that does not fit the new diameter falls back to a through hole.
 * T320 (D-108): with the machine's `tools`, a new hole takes the best compatible tool (a drill of
 * its size, else `tool` when it suits, else a mill that suits); a copied tool that no longer suits
 * the new diameter is replaced the same way.
 */
export function addHoleParams(
  project: Project,
  draft: HoleDraft,
  d: number,
  tool: number,
  like?: Hole,
  tools?: readonly HoleRuleTool[] | null,
): { id: string; hole: Hole } | null {
  const part = project.parts.find((p) => p.id === draft.partId);
  const at = boardPositions(project).get(draft.partId);
  if (!part || !at || !(d > 0)) return null;
  const base = {
    id: nextHoleId(part),
    d: r3(d),
    cx: r3(draft.c.x - at.x),
    cy: r3(draft.c.y - at.y),
  };
  const fitTool = (hole: Hole): Hole =>
    tools && holeToolProblem(hole, tools) !== null
      ? { ...hole, tool: bestHoleTool(hole, tools, tool) }
      : hole;
  if (like) {
    const copy = holeSchema.safeParse({ ...like, ...base });
    if (copy.success) return { id: part.id, hole: fitTool(copy.data) };
  }
  const fresh: Hole = { ...base, type: 'through', tool };
  return {
    id: part.id,
    hole: tools ? { ...fresh, tool: bestHoleTool(fresh, tools, tool) } : fresh,
  };
}

/** The last hole added in this session, as it is now (edited since), or the remembered copy. */
export function lastHoleNow(
  project: Project,
  last: { partId: string; hole: Hole } | null,
): Hole | undefined {
  if (!last) return undefined;
  const now = project.parts
    .find((p) => p.id === last.partId)
    ?.holes.find((h) => h.id === last.hole.id);
  return now ?? last.hole;
}

/**
 * Values a type switch fills in when the hole has none yet: depth half the stock (to 0.5 mm,
 * at least 1 mm, below the thickness) and a groove as wide as the tool but narrower than d.
 */
export function holeDefaults(
  hole: Hole,
  thickness: number,
  toolDiameter: number,
): { depth: number; grooveWidth: number } {
  const depth =
    'depth' in hole
      ? hole.depth
      : Math.min(Math.max(1, Math.round(thickness) / 2), Math.max(thickness - 1, 0.5));
  const width =
    hole.type === 'groove' ? hole.grooveWidth : Math.min(toolDiameter, Math.max(hole.d / 2, 0.1));
  return { depth, grooveWidth: width };
}

/** Two hole centres closer than this are the same centre (mm, T276). */
export const SAME_CENTRE_MM = 0.5;

function clearInside(part: BoardPart, p: Pt, clearance: number): boolean {
  if (!insideContour(p, part.outline) || contourDistance(p, part.outline) < clearance) return false;
  return part.inners.every((c) => !insideContour(p, c) && contourDistance(p, c) >= clearance);
}

/**
 * Centre of a new hole (T276, CTO review #7 C): the snapped point when it lies inside a part with
 * room for the smallest hole (`clearance` = tool radius); otherwise, when the clicked point itself
 * is inside a part, the clicked point rounded to whole mm in the part frame (a grid that snaps a
 * hinge cup 22.5 mm from the edge onto the edge must not refuse it). Null = no part there.
 */
export function holeCentre(
  parts: readonly BoardPart[],
  raw: Pt,
  snapped: Pt,
  clearance: number,
): { partId: string; c: Pt } | null {
  const rawPart = hitPart(parts, raw, 0);
  const pick = (part: BoardPart | undefined, p: Pt) =>
    part && clearInside(part, p, clearance) ? { partId: part.id, c: p } : null;
  const byId = (id: string | null) => parts.find((p) => p.id === id);
  // Snapped first, but only inside the part that was clicked (when one was).
  const snappedPart = rawPart ? byId(rawPart) : byId(hitPart(parts, snapped, 0));
  const fromSnap = pick(snappedPart, snapped);
  if (fromSnap) return fromSnap;
  const part = byId(rawPart);
  if (!part) return null;
  const c = {
    x: part.at.x + Math.round(raw.x - part.at.x),
    y: part.at.y + Math.round(raw.y - part.at.y),
  };
  // Rounding never leaves the part when the raw point was inside it.
  return { partId: part.id, c: hitPart(parts, c, 0) === part.id ? c : raw };
}

/** 0-based index of the part's hole already on this centre (T276), or null. */
export function holeOnCentre(part: BoardPart | undefined, c: Pt): number | null {
  const i = part?.holes.findIndex((h) => Math.hypot(h.x - c.x, h.y - c.y) < SAME_CENTRE_MM) ?? -1;
  return i >= 0 ? i : null;
}

/** Why a drawn hole was refused (T276): its circle crosses the outline or touches a cut-out. */
export function holeRefusal(
  project: Project,
  params: { id: string; hole: Hole },
): HolePlacementError | null {
  const part = project.parts.find((p) => p.id === params.id);
  if (!part) return 'outside';
  return checkHolePlacement(deriveOutline(part), part.inners, params.hole) ?? null;
}

/** A typed diameter ("35", "12,5"), mm; null when it is not a positive number. */
export function typedDiameter(text: string): number | null {
  const v = Number(text.replace(',', '.'));
  return text !== '' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Below this zoom (px per mm) the hole tool does not snap onto centres (B52, D-096). */
export const HOLE_CENTRE_SNAP_SCALE = 2;

/**
 * True when the hole tool may snap its centre onto hole / contour centres (B52, D-096): only at a
 * usable zoom, where the snap reach (`snapPx` screen px) stays within a few millimetres.
 */
export function holeCentreSnap(scale: number): boolean {
  return scale >= HOLE_CENTRE_SNAP_SCALE;
}
