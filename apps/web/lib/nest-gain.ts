import type { LayoutSummary } from '@nittcam/core';
import { inRing } from './label-spot';

/**
 * B44 feedback when a nesting option gains nothing (CTO #8–#10): "İç boşluğa 0 parça",
 * "45° kazanç yok". Pure helpers; the Dizilim panel shows their result under the option.
 */

interface Copy {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cut-outs in the footprint frame (Y down). */
  inners: readonly (readonly number[])[];
}

/** Copies of one sheet whose centre lies in a cut-out of another copy (part in hole). */
export function copiesInHoles(copies: readonly Copy[]): number {
  const hosts = copies.filter((c) => c.inners.length > 0);
  if (hosts.length === 0) return 0;
  let n = 0;
  for (const c of copies) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const inside = hosts.some(
      (h) =>
        h.key !== c.key &&
        cx > h.x &&
        cx < h.x + h.w &&
        cy > h.y &&
        cy < h.y + h.h &&
        h.inners.some((ring) => inRing(cx - h.x, h.y + h.h - cy, ring)),
    );
    if (inside) n++;
  }
  return n;
}

/**
 * True when a finer rotation (45° / 15°) gave no better result than 90° steps: the same sheet
 * count and no less waste (0.05 points tolerance).
 */
export function rotationGainsNothing(fine: LayoutSummary, coarse: LayoutSummary): boolean {
  if (fine.unplaced.length < coarse.unplaced.length) return false;
  if (fine.sheetCount < coarse.sheetCount) return false;
  return fine.wastePercent >= coarse.wastePercent - 0.05;
}
