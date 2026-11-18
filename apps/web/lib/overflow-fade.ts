/** Fade edges for horizontally scrolling strips (plate tabs, T199b). Pure helpers. */

/** Width of the fade at a clipped edge, px. */
export const FADE_PX = 28;

/** Which edges of a horizontal scroller have hidden content. */
export function overflowEdges(el: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): { start: boolean; end: boolean } {
  const max = el.scrollWidth - el.clientWidth;
  return { start: el.scrollLeft > 1, end: max - el.scrollLeft > 1 };
}

/** CSS mask that fades the clipped edges (alpha only, no colour). */
export function fadeMask(edges: { start: boolean; end: boolean }): string | undefined {
  if (!edges.start && !edges.end) return undefined;
  const a = edges.start ? `transparent 0, black ${FADE_PX}px` : 'black 0';
  const b = edges.end ? `black calc(100% - ${FADE_PX}px), transparent 100%` : 'black 100%';
  return `linear-gradient(to right, ${a}, ${b})`;
}
