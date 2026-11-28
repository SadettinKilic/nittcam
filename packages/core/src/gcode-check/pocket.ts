/**
 * Blind contour pockets against the read path (T325, D-112, LAYOUT). Every pocket the layout
 * expects comes with its boundary (sheet frame, from the project) and its declared depth; the
 * read program is judged against them, with the checks' own geometry (no toolpath or post code):
 * - a cutting move (below the material top) that touches the inside of a pocket must stay inside
 *   it with the tool: every sampled point inside the boundary and at least the tool radius from it
 *   (`POCKET_OUTSIDE_BOUNDARY`), so nothing leaves the pocket or the part;
 * - no such move goes deeper than the declared depth (`POCKET_TOO_DEEP`);
 * - the pocket floor is reached somewhere (`POCKET_NOT_CUT`).
 * The tool radius is the active tool's (the read tool changes), else the smallest profile tool.
 * Pure.
 */
import type { GcodeEvent } from '../gcode-reader';
import type { Derived } from './derive';
import { angleTravelled, type SheetMove } from './path';
import type { Push } from './rules';
import type { ExpectedPart } from './types';

type XY = { x: number; y: number };

/** Sampling step along a read move, mm (a pocket boundary is at least a tool radius away). */
const SAMPLE_STEP = 0.5;
const MAX_SAMPLES = 2000;
/** Extra slack for the sampled boundary (arc chords), mm. */
const CHORD_SLACK = 0.01;

function insidePolygon(p: XY, poly: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as XY;
    const b = poly[j] as XY;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function boundaryDistance(p: XY, poly: readonly XY[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as XY;
    const b = poly[(i + 1) % poly.length] as XY;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

/** Points along a read move (start and end included), Z linear along the move. */
export function moveSamples(m: SheetMove): (XY & { z: number })[] {
  const out: (XY & { z: number })[] = [];
  if (m.arc) {
    const a = m.arc;
    const a0 = Math.atan2(m.from.y - a.cy, m.from.x - a.cx);
    const a1 = Math.atan2(m.to.y - a.cy, m.to.x - a.cx);
    let sweep = angleTravelled(a0, a1, a.dir);
    if (sweep < 1e-9) sweep = a.sweep;
    const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil((a.r * sweep) / SAMPLE_STEP)));
    const s = a.dir === 'ccw' ? 1 : -1;
    for (let k = 0; k <= n; k++) {
      const t = a0 + (s * sweep * k) / n;
      out.push({
        x: a.cx + a.r * Math.cos(t),
        y: a.cy + a.r * Math.sin(t),
        z: m.from.z + ((m.to.z - m.from.z) * k) / n,
      });
    }
    return out;
  }
  const len = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
  const n = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(len / SAMPLE_STEP)));
  for (let k = 0; k <= n; k++) {
    out.push({
      x: m.from.x + ((m.to.x - m.from.x) * k) / n,
      y: m.from.y + ((m.to.y - m.from.y) * k) / n,
      z: m.from.z + ((m.to.z - m.from.z) * k) / n,
    });
  }
  return out;
}

/**
 * Tool radius of each read move: the active tool of the job (`activeTools`, B62 fix r1: Mach3
 * writes no T word). An unknown tool takes the largest radius of the job, never the smallest
 * (the strictest for "the cutter stays inside the pocket"); `motionRules` reports TOOL_UNKNOWN.
 */
function radii(tools: readonly (number | null)[], d: Derived): number[] {
  const largest = Math.max(0, ...d.ops.map((o) => o.toolDiameter / 2));
  return tools.map((t) => {
    const op = t === null ? undefined : d.ops.find((o) => o.tool === t);
    return op ? op.toolDiameter / 2 : largest;
  });
}

function pocketsOf(expected: readonly ExpectedPart[]) {
  return expected.flatMap((e) =>
    (e.pockets ?? []).map((p) => ({ part: e, key: `${e.partId}#${e.copy}/${p.inner}`, ...p })),
  );
}

/**
 * Judges the moves of one file against the expected pockets; returns the keys
 * (`<part>#<copy>/<inner>`) of the pockets whose floor the file reached.
 */
export function pocketMoveRule(
  sm: readonly SheetMove[],
  events: readonly GcodeEvent[],
  expected: readonly ExpectedPart[],
  d: Derived,
  push: Push,
  tools: readonly (number | null)[],
): Set<string> {
  const pockets = pocketsOf(expected);
  const reachedKeys = new Set<string>();
  if (pockets.length === 0) return reachedKeys;
  const tol = d.posTol + CHORD_SLACK;
  const r = radii(tools, d);
  const reached = new Set<number>();
  const reported = new Set<number>();
  sm.forEach((m, i) => {
    if (m.kind === 'rapid' || Math.min(m.from.z, m.to.z) >= -d.posTol) return;
    const pts = moveSamples(m);
    pockets.forEach((p, pi) => {
      if (reported.has(pi)) return;
      if (!pts.some((q) => insidePolygon(q, p.boundary))) return;
      const name = `Pocket (inner contour ${p.inner + 1}) of part ${p.part.partId} (copy ${p.part.copy})`;
      const out = pts.find(
        (q) => !insidePolygon(q, p.boundary) || boundaryDistance(q, p.boundary) < (r[i] ?? 0) - tol,
      );
      if (out) {
        reported.add(pi);
        push(
          'LAYOUT',
          'POCKET_OUTSIDE_BOUNDARY',
          m.line,
          `${name}: the tool reaches (${out.x.toFixed(4)}, ${out.y.toFixed(4)}), outside the pocket minus the tool radius ${(r[i] ?? 0).toFixed(3)} mm.`,
        );
        return;
      }
      const low = Math.min(...pts.map((q) => q.z));
      if (low < -p.depth - d.posTol) {
        reported.add(pi);
        push(
          'LAYOUT',
          'POCKET_TOO_DEEP',
          m.line,
          `${name}: Z ${low.toFixed(4)} is below the declared depth ${p.depth} mm.`,
        );
        return;
      }
      if (low <= -p.depth + d.posTol) reached.add(pi);
    });
  });
  pockets.forEach((p, pi) => {
    // A pocket with a reported violation counts as reached (one finding per pocket).
    if (reported.has(pi) || reached.has(pi)) reachedKeys.add(p.key);
  });
  return reachedKeys;
}

/** Every expected pocket must be cleared to its depth somewhere in the sheet's files. */
export function pocketNotCutRule(
  expected: readonly ExpectedPart[],
  reached: ReadonlySet<string>,
  push: Push,
): void {
  for (const p of pocketsOf(expected)) {
    if (reached.has(p.key)) continue;
    push(
      'LAYOUT',
      'POCKET_NOT_CUT',
      0,
      `Pocket (inner contour ${p.inner + 1}) of part ${p.part.partId} (copy ${p.part.copy}) is not cleared to its depth ${p.depth} mm.`,
    );
  }
}
