/**
 * Bağlantı elemanı helper (T390, D-131): a standard screw or rivet marker through every pair of
 * aligned holes on mating faces of the montaj tezgâhı (the T388 hole check's green pairs), so the
 * owner sees where fasteners go and how many the job needs. Display only: never part of nesting,
 * toolpath or NC. Pure and deterministic (the server PDF list counts them too).
 *
 * Kind: a rivet when every part of the stack is metal (ACM, aluminium) and every hole runs through;
 * a screw otherwise. Diameter: the smallest hole of the stack. Length: the next standard length
 * that spans the stack (a rivet adds 1.5 × d for the set head); a screw ending in a blind hole
 * takes the longest standard length that stays inside the stack.
 */
import { MATERIAL_TRAITS, type MaterialKind } from '@nittcam/core';
import { add, boxCentre, dot, len, scale, sub, type V3 } from './assembly-math';
import type { BenchItem } from './assembly-model';
import { fitHoles } from './fit-check-input';
import {
  candidatePairs,
  HOLE_OK_MM,
  matedHoles,
  MATE_FACE_MM,
  toWorld,
  type FitPart,
} from './fit-check';

export type FastenerKind = 'screw' | 'rivet';

/** Standard lengths, mm (screws and blind rivets share the list; display only). */
export const FASTENER_LENGTHS = [
  6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100, 120, 150, 200,
] as const;
/** Two marks this close to one line (mm) along the same axis are one fastener through a stack. */
const SAME_LINE_MM = 0.5;

export interface Fastener {
  kind: FastenerKind;
  /** Nominal diameter, mm (the smallest hole of the stack, 0.1 mm). */
  d: number;
  /** Standard length, mm. */
  length: number;
  /** Head end and tip end of the marker, world mm. */
  head: V3;
  tip: V3;
  /** Instance ids of the stacked parts, head side first. */
  parts: string[];
}

interface Line {
  /** A point on the axis and the unit axis (out of the head part). */
  at: V3;
  axis: V3;
  d: number;
  through: boolean;
  parts: Set<string>;
}

/** ACM and aluminium (the metal families). */
const isMetal = (k: MaterialKind) =>
  MATERIAL_TRAITS[k].family === 'nonFerrous' || MATERIAL_TRAITS[k].family === 'composite';

/** Standard length for a stack: spanning it, or (blind end) the longest that stays inside. */
export function standardLength(kind: FastenerKind, stack: number, d: number, through: boolean) {
  if (kind === 'rivet') {
    const need = stack + 1.5 * d;
    return FASTENER_LENGTHS.find((l) => l >= need - 1e-9) ?? need;
  }
  if (through) return FASTENER_LENGTHS.find((l) => l >= stack - 1e-9) ?? Math.ceil(stack);
  const inside = [...FASTENER_LENGTHS].reverse().find((l) => l <= stack - 1 + 1e-9);
  return inside ?? FASTENER_LENGTHS[0];
}

/** Lateral distance of point p from the line (at, axis). */
function offLine(p: V3, at: V3, axis: V3): number {
  const d = sub(p, at);
  return len(sub(d, scale(axis, dot(d, axis))));
}

/** The fastener markers of the visible bench items (hidden ones are left out). */
export function fastenersOf(items: readonly BenchItem[]): Fastener[] {
  const shown = items.filter((i) => !i.hidden);
  const parts: FitPart[] = shown.map((it) => ({
    id: it.id,
    box: it.box,
    pose: it.pose,
    holes: it.fold?.holes ?? fitHoles(it),
    boxy: true,
  }));
  const byId = new Map(shown.map((it) => [it.id, it]));
  const lines: Line[] = [];
  for (const [i, j] of candidatePairs(parts, MATE_FACE_MM)) {
    const a = parts[i];
    const b = parts[j];
    if (!a || !b) continue;
    for (const m of matedHoles(a, b)) {
      if (m.offset > HOLE_OK_MM || !(m.a.through || m.b.through)) continue;
      const d = Math.min(m.a.d, m.b.d);
      const through = m.a.through && m.b.through;
      // Head on the through-hole side: a blind hole of A means the screw comes in from B.
      const flip = !m.a.through;
      const axis = flip ? scale(m.normal, -1) : m.normal;
      const hit = lines.find(
        (l) =>
          Math.abs(Math.abs(dot(l.axis, axis)) - 1) < 1e-6 &&
          offLine(m.at, l.at, l.axis) <= SAME_LINE_MM &&
          (l.parts.has(a.id) || l.parts.has(b.id)),
      );
      if (hit) {
        hit.parts.add(a.id).add(b.id);
        hit.d = Math.min(hit.d, d);
        hit.through &&= through;
      } else lines.push({ at: m.at, axis, d, through, parts: new Set([a.id, b.id]) });
    }
  }
  const out: Fastener[] = [];
  for (const l of lines) {
    const stack = [...l.parts].map((id) => byId.get(id)).filter((x): x is BenchItem => !!x);
    // Extent of the stack along the axis: both large faces of every part.
    let lo = Infinity;
    let hi = -Infinity;
    const ends: { id: string; lo: number }[] = [];
    for (const it of stack) {
      const c = boxCentre(it.box);
      let plo = Infinity;
      for (const zz of [it.box.min[2], it.box.max[2]]) {
        const s = dot(toWorld(it.pose, it.box, [c[0], c[1], zz]), l.axis);
        plo = Math.min(plo, s);
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      ends.push({ id: it.id, lo: plo });
    }
    if (!Number.isFinite(lo)) continue;
    const metal = stack.every((it) => isMetal(it.look));
    const kind: FastenerKind = metal && l.through ? 'rivet' : 'screw';
    const d = Math.round(l.d * 10) / 10;
    const length = standardLength(kind, hi - lo, d, l.through);
    const base = sub(l.at, scale(l.axis, dot(l.at, l.axis)));
    out.push({
      kind,
      d,
      length,
      head: add(base, scale(l.axis, lo)),
      tip: add(base, scale(l.axis, lo + length)),
      parts: ends.sort((p, q) => p.lo - q.lo || (p.id < q.id ? -1 : 1)).map((e) => e.id),
    });
  }
  return out;
}

export interface FastenerRow {
  kind: FastenerKind;
  d: number;
  length: number;
  qty: number;
}

/** Fasteners grouped for a parts list (kind, diameter, length), screws first, then by size. */
export function fastenerRows(list: readonly Fastener[]): FastenerRow[] {
  const map = new Map<string, FastenerRow>();
  for (const f of list) {
    const key = `${f.kind}:${f.d}:${f.length}`;
    const row = map.get(key) ?? { kind: f.kind, d: f.d, length: f.length, qty: 0 };
    row.qty++;
    map.set(key, row);
  }
  return [...map.values()].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'screw' ? -1 : 1) || a.d - b.d || a.length - b.length,
  );
}
