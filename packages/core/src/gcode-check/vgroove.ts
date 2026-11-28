/**
 * Checker rule 17 (T354, spec §7.2 rule 17, analysis R17): V-grooves of a composite panel against
 * the read path, with the checks' own geometry (no toolpath or post code):
 * - `VGROOVE_TOO_DEEP`: with a V-bit in the spindle no move goes below −(thickness − minimum
 *   remaining). The floor comes from the stock and the material traits in the check context
 *   (`context.vGroove.minRemaining`, 0,7 mm on ACM), never from the toolpath or the user's value.
 * - `VGROOVE_WRONG_TOOL`: a V-bit that cuts through (a contour with a V-bit), or a cutting move of
 *   another tool type that runs along an expected fold line (a groove cut with an end mill).
 * - `VGROOVE_MISSING`: every expected fold line (sampled from the project, `ExpectedPart.grooves`)
 *   is covered by V-bit cuts at its depth within tolerance, over all files of the sheet.
 * Silent for jobs without `context.vGroove` (materials without `traits.vGroove`). Pure.
 */
import type { Derived } from './derive';
import type { SheetMove } from './path';
import { moveSamples } from './pocket';
import type { Push } from './rules';
import type { ExpectedPart } from './types';

type XY = { x: number; y: number };

/** XY tolerance of a groove cut against its fold line, mm (arc chords, written decimals). */
export const GROOVE_TOL = 0.05;
/** A move of another tool shorter than this along a fold line is not judged (entries, crossings). */
const ALONG_MIN = 1;

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function chainDist(p: XY, pts: readonly XY[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    best = Math.min(best, segDist(p, pts[i] as XY, pts[i + 1] as XY));
  }
  return pts.length === 1 ? Math.hypot(p.x - (pts[0] as XY).x, p.y - (pts[0] as XY).y) : best;
}

function groovesOf(expected: readonly ExpectedPart[]) {
  return expected.flatMap((e) =>
    (e.grooves ?? []).map((g) => ({ part: e, key: `${e.partId}#${e.copy}/${g.id}`, ...g })),
  );
}

function toolType(d: Derived, tool: number | null): string | undefined {
  return tool === null ? undefined : d.ctx.profile.tools.find((t) => t.number === tool)?.type;
}

/**
 * Judges one file: depth floor and tool type of every cutting move; returns the covered sample
 * indexes per groove key (`<part>#<copy>/<groove>`), merged by the caller over a sheet's files.
 */
export function vGrooveMoveRule(
  sm: readonly SheetMove[],
  expected: readonly ExpectedPart[] | null | undefined,
  d: Derived,
  push: Push,
  tools: readonly (number | null)[],
  covered: Map<string, Set<number>> = new Map(),
): Map<string, Set<number>> {
  const rule = d.ctx.vGroove;
  if (!rule) return covered;
  const t = d.ctx.stock.thickness;
  const floor = -(t - rule.minRemaining);
  const grooves = groovesOf(expected ?? []);
  const tol = GROOVE_TOL + d.posTol;
  let deepReported = false;
  let throughReported = false;
  let alongReported = false;
  sm.forEach((m, i) => {
    if (m.kind === 'rapid' || Math.min(m.from.z, m.to.z) >= -d.posTol) return;
    const pts = moveSamples(m);
    const low = Math.min(...pts.map((q) => q.z));
    const v = toolType(d, tools[i] ?? null) === 'vBit';
    if (v) {
      if (low <= -t + d.posTol) {
        if (!throughReported) {
          throughReported = true;
          push(
            'R17',
            'VGROOVE_WRONG_TOOL',
            m.line,
            `A V-bit cuts through the ${t} mm panel (Z ${low.toFixed(4)}); contours are cut with an end mill only.`,
          );
        }
        return;
      }
      if (low < floor - d.posTol) {
        if (!deepReported) {
          deepReported = true;
          push(
            'R17',
            'VGROOVE_TOO_DEEP',
            m.line,
            `The V-bit reaches Z ${low.toFixed(4)}, below ${floor.toFixed(4)} (thickness ${t} mm − minimum remaining ${rule.minRemaining} mm): the front face would be cut.`,
          );
        }
      }
      // A move level at or below a groove's depth covers the fold-line samples along it.
      const top = Math.max(m.from.z, m.to.z);
      const bx0 = Math.min(...pts.map((q) => q.x)) - tol;
      const bx1 = Math.max(...pts.map((q) => q.x)) + tol;
      const by0 = Math.min(...pts.map((q) => q.y)) - tol;
      const by1 = Math.max(...pts.map((q) => q.y)) + tol;
      const near = (p: XY) => p.x >= bx0 && p.x <= bx1 && p.y >= by0 && p.y <= by1;
      for (const g of grooves) {
        if (top > -g.depth + d.posTol) continue;
        const set = covered.get(g.key) ?? new Set<number>();
        g.line.forEach((p, k) => {
          if (!set.has(k) && near(p) && chainDist(p, pts) <= tol) set.add(k);
        });
        if (set.size > 0) covered.set(g.key, set);
      }
      return;
    }
    if (alongReported || grooves.length === 0) return;
    const len = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
    if (len < ALONG_MIN && !m.arc) return;
    const along = grooves.find((g) => pts.every((q) => chainDist(q, g.line) <= tol));
    if (along) {
      alongReported = true;
      push(
        'R17',
        'VGROOVE_WRONG_TOOL',
        m.line,
        `Fold line ${along.id} of part ${along.part.partId} (copy ${along.part.copy}) is cut with T${tools[i] ?? '?'}, not a V-bit.`,
      );
    }
  });
  return covered;
}

/** Every expected fold line must be covered over its whole length in the sheet's files. */
export function vGrooveMissingRule(
  expected: readonly ExpectedPart[] | null | undefined,
  covered: ReadonlyMap<string, ReadonlySet<number>>,
  d: Derived,
  push: Push,
): void {
  if (!d.ctx.vGroove) return;
  for (const g of groovesOf(expected ?? [])) {
    const set = covered.get(g.key);
    if (set && set.size === g.line.length) continue;
    push(
      'R17',
      'VGROOVE_MISSING',
      0,
      `Fold line ${g.id} of part ${g.part.partId} (copy ${g.part.copy}) is not grooved to ${g.depth} mm over its length (${set?.size ?? 0}/${g.line.length} points).`,
    );
  }
}
