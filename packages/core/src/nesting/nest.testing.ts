/**
 * Test helpers for the placer invariants (spec §6.2, nesting-engine skill). Not exported from the
 * package; used by the unit, property and tester tests.
 */
import { EPS } from '../geometry/constants';
import type { Placement } from '../schema';
import { partSpacing, placementRect } from './nest';
import type { NestingInput, NestingResult, Rect } from './types';

/** Distance between two rectangles along the axis where they are separated (≤ 0 = overlapping). */
export function separation(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.max(dx, dy);
}

/**
 * Every invariant of the placer as a list of violations (empty = all fine). Tolerance EPS: the bins
 * accept a fit within EPS (D-019).
 */
export function invariantViolations(input: NestingInput, result: NestingResult): string[] {
  const out: string[] = [];
  const sizes = new Map(input.parts.map((p) => [p.id, { w: p.w, h: p.h }]));
  const grain = new Map(input.parts.map((p) => [p.id, p.grainLock]));
  const s = partSpacing(input.toolDiameter, input.gap);
  const required = 2 * s; // toolDiameter + gap
  const ux0 = input.margin;
  const uy0 = input.margin;
  const ux1 = input.sheet.width - input.margin;
  const uy1 = input.sheet.height - input.margin;

  // Locked placements unchanged, on the same sheet, in the same order, first.
  input.locked.forEach((locked, i) => {
    const got = result.layout.sheets[i]?.placements.slice(0, locked.length) ?? [];
    if (JSON.stringify(got) !== JSON.stringify(locked)) out.push(`locked placements moved on ${i}`);
  });

  // Every copy placed once or unplaced once.
  const seen = new Map<string, number>();
  const count = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);
  result.layout.sheets.forEach((sh) =>
    sh.placements.forEach((p) => count(`${p.partId}#${p.index}`)),
  );
  result.unplaced.forEach((u) => {
    count(`${u.partId}#${u.index}`);
    if (!u.reason) out.push(`unplaced ${u.partId}#${u.index} has no reason`);
  });
  const expected = new Set<string>();
  for (const p of input.parts) for (let i = 0; i < p.qty; i++) expected.add(`${p.id}#${i}`);
  for (const key of expected) {
    const n = seen.get(key) ?? 0;
    if (n !== 1) out.push(`${key} appears ${n} times`);
  }
  for (const key of seen.keys()) if (!expected.has(key)) out.push(`unknown copy ${key}`);

  if (result.sheetCount !== result.layout.sheets.length) out.push('sheetCount mismatch');

  result.layout.sheets.forEach((sh, si) => {
    const nLocked = input.locked[si]?.length ?? 0;
    const rects = sh.placements.map((p) => placementRect(p, sizes));
    sh.placements.forEach((p: Placement, pi) => {
      const r = rects[pi];
      if (!r) return;
      if (pi < nLocked) return; // locked: given, not checked
      if (p.locked) out.push(`new placement ${p.partId}#${p.index} is locked`);
      if (grain.get(p.partId) && (p.rot === 90 || p.rot === 270)) {
        out.push(`grain-locked ${p.partId}#${p.index} turned ${p.rot}`);
      }
      if (r.x < ux0 - EPS || r.y < uy0 - EPS || r.x + r.w > ux1 + EPS || r.y + r.h > uy1 + EPS) {
        out.push(`${p.partId}#${p.index} outside the usable area on sheet ${si}`);
      }
      // Against every other placement on the sheet (locked included).
      rects.forEach((o, oi) => {
        if (!o || oi === pi || (oi > pi && oi >= nLocked)) return;
        const sep = separation(r, o);
        if (sep < required - EPS) {
          out.push(
            `${p.partId}#${p.index} is ${sep} mm from ${sh.placements[oi]!.partId}#${sh.placements[oi]!.index} on sheet ${si} (needs ${required})`,
          );
        }
      });
    });
  });
  return out;
}
