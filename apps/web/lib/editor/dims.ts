/**
 * Dimension labels and the dimension tool (T133, spec §4.4 "ekranda ölçü etiketleri"): pure
 * helpers for the drawing board. Labels have a fixed size on screen (always readable); a label
 * that does not fit next to its segment at the current zoom is left out, except the active one.
 */
import { segmentLength, segmentMidpoint, type BoardPart, type Vertex } from '@nittcam/core';
import { MONO_ADVANCE, formatMm } from '../canvas-labels';
import type { Pt } from './viewport';

/** Font size of the dimension chips on screen, px (same as the selection size chip). */
export const DIM_FONT_PX = 11;
/** Distance of a segment label from its segment, px on screen. */
export const LABEL_GAP_PX = 18;

export interface SegmentLabel {
  /** Board mm, already moved off the segment to the outside. */
  at: Pt;
  text: string;
  /** The segment the properties panel edits (drawn in the accent, always shown). */
  active: boolean;
}

/** Width of a mono chip with `text` on screen, px (padding included). */
export function chipWidthPx(text: string): number {
  return text.length * DIM_FONT_PX * MONO_ADVANCE + 10;
}

/**
 * Length labels of a part's segments (outline and inner contours) at `scale` px/mm. The label
 * sits beside the segment middle, on the right of travel: outside for the CCW outline, inside the
 * opening for a CW inner contour. `active` = outline segment index the panel edits.
 */
export function segmentLabels(
  outline: readonly Vertex[],
  inners: readonly (readonly Vertex[])[],
  scale: number,
  active: number | null = null,
): SegmentLabel[] {
  const out: SegmentLabel[] = [];
  const contours = [outline, ...inners];
  contours.forEach((vs, c) => {
    const n = vs.length;
    for (let i = 0; i < n; i++) {
      const p0 = vs[i] as Vertex;
      const p1 = vs[(i + 1) % n] as Vertex;
      const len = segmentLength(p0, p1, p0.bulge);
      if (!(len > 0)) continue;
      const isActive = c === 0 && i === active;
      const text = formatMm(len);
      // Room on screen: the segment must be longer than its chip (plus a little air).
      if (!isActive && len * scale < chipWidthPx(text) + 8) continue;
      const mid = segmentMidpoint(p0, p1, p0.bulge);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const d = Math.hypot(dx, dy) || 1;
      // Right of travel; an arc bulging outwards moves its middle out too, the label follows it.
      const k = LABEL_GAP_PX / scale;
      out.push({
        at: { x: mid.x + (dy / d) * k, y: mid.y - (dx / d) * k },
        text,
        active: isActive,
      });
    }
  });
  return out;
}

function contains(p: BoardPart, q: Pt, tol: number): boolean {
  return (
    q.x >= p.box.minX - tol &&
    q.x <= p.box.maxX + tol &&
    q.y >= p.box.minY - tol &&
    q.y <= p.box.maxY + tol
  );
}

/**
 * The part a new dimension a–b belongs to: a part whose box holds both points (`tol` mm of air
 * for points snapped on the edge); the preferred (selected) part first, else the smallest box.
 * Null when no part holds both points (a dimension always belongs to one part).
 */
export function dimOwner(
  parts: readonly BoardPart[],
  a: Pt,
  b: Pt,
  preferred: string | null,
  tol = 0.5,
): string | null {
  const hits = parts.filter((p) => contains(p, a, tol) && contains(p, b, tol));
  if (hits.length === 0) return null;
  const pick = hits.find((p) => p.id === preferred);
  if (pick) return pick.id;
  const area = (p: BoardPart) => (p.box.maxX - p.box.minX) * (p.box.maxY - p.box.minY);
  return hits.reduce((best, p) => (area(p) < area(best) ? p : best)).id;
}

/** Text of a dimension a–b: its aligned length in Turkish digits. */
export function dimText(a: Pt, b: Pt): string {
  return formatMm(Math.hypot(b.x - a.x, b.y - a.y));
}
