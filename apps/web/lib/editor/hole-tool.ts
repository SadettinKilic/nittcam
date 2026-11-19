/**
 * Hole tool of the drawing board (T138, spec §4.5): click the centre on a part, the diameter
 * grows live with the cursor, the second click adds the hole (one `addHole`). Pure helpers; the
 * board keeps the in-progress centre as UI state.
 */
import { boardPositions, type Hole, type Part, type Project } from '@nittcam/core';
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
 * properties panel turns it into a pocket or a groove) in the part frame.
 */
export function addHoleParams(
  project: Project,
  draft: HoleDraft,
  d: number,
  tool: number,
): { id: string; hole: Hole } | null {
  const part = project.parts.find((p) => p.id === draft.partId);
  const at = boardPositions(project).get(draft.partId);
  if (!part || !at || !(d > 0)) return null;
  return {
    id: part.id,
    hole: {
      id: nextHoleId(part),
      type: 'through',
      d: r3(d),
      cx: r3(draft.c.x - at.x),
      cy: r3(draft.c.y - at.y),
      tool,
    },
  };
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
