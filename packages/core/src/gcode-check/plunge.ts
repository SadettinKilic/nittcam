/**
 * Checker rule 12 (T423, spec §7.2 rule 12, CTO #15 M1): in a non-ferrous metal or composite panel
 * no descent into the material is steeper than the table limit (5°). Judged on the read path with
 * the checks' own geometry (no toolpath or post code):
 * - every feed move (line or helical arc) whose end lies below the material top (sheet frame Z 0)
 *   and that goes down there;
 * - only the part of the move below the top counts (a feed down through the air to the top, or a
 *   ramp that starts above it, is judged on what enters the panel);
 * - the descent over that part's XY travel must be at most `tan(maxDeg)`, with half a written unit
 *   of slack per end; a vertical move is the worst case (90°);
 * - a drill (tool type `drill`) is excepted: rule 12 allows pecking with a drill.
 * The limit comes from the stock's traits in the check context (`context.noStraightPlunge`), never
 * from the toolpath. Silent without it (wood, plastic). Pure.
 */
import type { Derived } from './derive';
import type { SheetMove } from './path';
import type { Push } from './rules';

/** Most violations reported per file (the rest are the same fault). */
const MAX_REPORTS = 5;

function xyTravel(m: SheetMove): number {
  return m.arc ? m.arc.r * Math.abs(m.arc.sweep) : Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
}

/** Descent angle, degrees, of the part of a feed move below the material top; null = none. */
export function descentIntoMaterial(m: SheetMove, tol: number): number | null {
  if (m.kind === 'rapid') return null;
  const top = Math.min(m.from.z, 0);
  const drop = top - m.to.z;
  if (!(drop > tol)) return null;
  const total = m.from.z - m.to.z;
  const xy = (xyTravel(m) * drop) / total;
  return (Math.atan2(drop, xy) * 180) / Math.PI;
}

export function straightPlungeRule(
  sm: readonly SheetMove[],
  d: Derived,
  push: Push,
  tools: readonly (number | null)[],
): void {
  const rule = d.ctx.noStraightPlunge;
  if (!rule) return;
  const tol = d.posTol;
  const tan = Math.tan((rule.maxDeg * Math.PI) / 180);
  let reported = 0;
  sm.forEach((m, i) => {
    if (reported >= MAX_REPORTS || m.kind === 'rapid') return;
    const top = Math.min(m.from.z, 0);
    const drop = top - m.to.z;
    if (!(drop > tol)) return;
    const tool = tools[i] ?? null;
    const type =
      tool === null ? undefined : d.ctx.profile.tools.find((t) => t.number === tool)?.type;
    if (type === 'drill') return;
    const xy = (xyTravel(m) * drop) / (m.from.z - m.to.z);
    // Written decimals round both ends: half a unit each way on Z and on XY.
    if (drop <= tan * (xy + 2 * tol) + 2 * tol) return;
    reported++;
    const deg = descentIntoMaterial(m, tol) ?? 90;
    push(
      'R12',
      'STRAIGHT_PLUNGE_IN_METAL',
      m.line,
      `Descent into the panel at ${deg.toFixed(1)}° (to Z ${m.to.z.toFixed(4)}); this material allows at most ${rule.maxDeg}° (ramp in, never plunge straight).`,
    );
  });
}
