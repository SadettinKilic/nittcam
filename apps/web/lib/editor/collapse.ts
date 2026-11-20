/**
 * Collapsed summary rows of the properties panel (B50, polish P1): holes and template instances are
 * one line each ("Delik 3 · Geçme · Ø35 · T2"); the row a person needs is open. Pure helpers.
 */
import type { Hole } from '@nittcam/core';
import { formatMm } from '../canvas-labels';

/**
 * Whether row `index` of `count` is open: the person's own toggle wins; otherwise the newest row
 * (the one just added) and every row with an error are open, the rest are closed.
 */
export function rowOpen(
  override: boolean | undefined,
  index: number,
  count: number,
  hasError: boolean,
): boolean {
  if (override !== undefined) return override;
  return index === count - 1 || hasError;
}

/** The short facts of a hole after its type: "Ø35", depth for a blind one, "T2". */
export function holeSummary(hole: Hole): string[] {
  const out = [`Ø${formatMm(hole.d)}`];
  if (hole.type !== 'through') out.push(`${formatMm(hole.depth)} mm`);
  out.push(`T${hole.tool}`);
  return out;
}
