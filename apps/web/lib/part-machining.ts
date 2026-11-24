import type { Part } from '@nittcam/core';

/** What a cut-list row marks as machining beyond the plain outline (B53, CTO #6 item 5). */
export type MachiningKind = 'shape' | 'inners' | 'holes' | 'templates' | 'lines';

export interface MachiningItem {
  kind: MachiningKind;
  count: number;
}

/**
 * The part's machining in reading order: a freeform outline, inner cuts, holes, hole templates
 * and open lines. Empty for a plain rectangle (rounded corners are still a rectangle).
 */
export function partMachining(part: Part): MachiningItem[] {
  const out: MachiningItem[] = [];
  if (part.kind === 'freeform') {
    out.push({ kind: 'shape', count: 1 });
  }
  const add = (kind: MachiningKind, count: number) => {
    if (count > 0) out.push({ kind, count });
  };
  add('inners', part.inners.length);
  add('holes', part.holes.length);
  add('templates', part.templates.length);
  add('lines', part.lines?.length ?? 0);
  return out;
}
