/**
 * Defence-in-depth checks of a toolpath against the §7.2 rules that belong to the toolpath layer
 * (D-021). The post (T017) and the independent reader (T019) check again; this catches a builder
 * bug before anything is exported. Pure.
 */
import { EPS } from '../geometry/constants';
import type { Move, Operation, Toolpath } from './types';

/** All moves of an operation in order. */
export function operationMoves(op: Operation): Move[] {
  return op.segments.flatMap((s) => s.moves);
}

/** All moves of a toolpath in order. */
export function toolpathMoves(tp: Toolpath): Move[] {
  return tp.operations.flatMap(operationMoves);
}

function finite(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x));
}

/**
 * Violations (empty = fine):
 * - every operation starts with a rapid at safe Z and ends at safe Z (rule 2);
 * - XY rapids only between two points at safe Z; no rapid ends below the clearance height, so a
 *   rapid never enters the material (rules 2, 3);
 * - every move that goes down in Z is a feed move at the plunge feed; plunges are vertical (rule 3);
 * - every feed is positive and finite; every coordinate finite (rule 8);
 * - no move below the target depth; no feed move above the material top (Z 0);
 * - tabs (D-022): every tab top lies strictly between the target depth and Z 0; a vertical feed
 *   move down (back into the cut after a tab) is a plunge at the plunge feed;
 * - arc ends are equidistant from the centre.
 */
export function toolpathSafetyViolations(tp: Toolpath): string[] {
  const out: string[] = [];
  const { safeZ, clearanceZ, targetDepth } = tp;
  const atSafe = (z: number) => Math.abs(z - safeZ) <= EPS;
  for (const op of tp.operations) {
    const moves = operationMoves(op);
    const first = moves[0];
    const last = moves[moves.length - 1];
    if (!first || first.kind !== 'rapid' || !atSafe(first.z)) {
      out.push(`${op.id}: does not start with a rapid at safe Z`);
    }
    if (!last || !atSafe(last.z)) out.push(`${op.id}: does not end at safe Z`);
    (op.tabs ?? []).forEach((t, k) => {
      if (!finite(t.z, t.x0, t.y0, t.x1, t.y1, t.start, t.end))
        out.push(`${op.id} tab ${k}: non-finite`);
      if (!(t.z > targetDepth + EPS && t.z < 0 - EPS))
        out.push(`${op.id} tab ${k}: tab top ${t.z} not between the target and Z 0`);
    });
    // Before the operation the tool is at safe Z (previous operation's end / program start).
    let prev = first ? { x: first.x, y: first.y, z: safeZ } : { x: 0, y: 0, z: safeZ };
    moves.forEach((m, i) => {
      const where = `${op.id} move ${i}`;
      if (!finite(m.x, m.y, m.z)) out.push(`${where}: non-finite coordinate`);
      if (m.z < targetDepth - EPS) out.push(`${where}: below the target depth (${m.z})`);
      const xyMoved = Math.hypot(m.x - prev.x, m.y - prev.y) > EPS;
      if (m.kind === 'rapid') {
        if (xyMoved && !(atSafe(prev.z) && atSafe(m.z)))
          out.push(`${where}: XY rapid below safe Z`);
        if (m.z < clearanceZ - EPS) out.push(`${where}: rapid ends below the clearance height`);
      } else {
        if (!finite(m.feed) || m.feed <= 0) out.push(`${where}: feed not positive`);
        if (m.z > EPS) out.push(`${where}: feed move above the material top (${m.z})`);
        if (m.z < prev.z - EPS && !xyMoved && m.kind !== 'plunge') {
          out.push(`${where}: vertical move down is not a plunge`);
        }
        if (m.z < prev.z - EPS && Math.abs(m.feed - op.plungeFeed) > EPS) {
          out.push(`${where}: goes down at ${m.feed} mm/min, not the plunge feed`);
        }
        if (m.kind === 'plunge') {
          if (xyMoved) out.push(`${where}: plunge moves in XY`);
          if (Math.abs(m.feed - op.plungeFeed) > EPS)
            out.push(`${where}: plunge not at plunge feed`);
        }
        if (m.kind === 'arc') {
          if (!finite(m.cx, m.cy, m.bulge)) out.push(`${where}: non-finite arc`);
          const r0 = Math.hypot(prev.x - m.cx, prev.y - m.cy);
          const r1 = Math.hypot(m.x - m.cx, m.y - m.cy);
          if (Math.abs(r0 - r1) > EPS) out.push(`${where}: arc ends not on one circle`);
        }
      }
      prev = { x: m.x, y: m.y, z: m.z };
    });
  }
  return out;
}
