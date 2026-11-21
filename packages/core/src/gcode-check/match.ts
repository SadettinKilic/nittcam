/**
 * Read path ≈ toolpath model (MODEL) and parts cut = layout (LAYOUT), spec §6.5 (T019, D-027).
 *
 * The read path is compared in the sheet frame (converted with the checks' own inverse frame)
 * move by move with the expected model:
 * - a rapid / plunge / linear model move is one read move of the same class ending at the same
 *   point (and, for feed moves, at the same feed);
 * - a model arc may be written as several arc pieces (sweep limit) or as chords (arcs off): every
 *   piece must keep the model's centre, radius, direction, helix height and feed, progress
 *   monotonically along the model's sweep and the last one must end at the model's end point;
 * - a model move of (near) zero length may be absent (the generator writes nothing for it);
 * - besides the model, only Z-only rapids up to safe Z may appear (the generator's first move,
 *   its retract after a tool change and its end retract).
 * The first divergence is reported; matching stops there. Pure.
 */
import { operationMoves, type Move, type Operation } from '../toolpath';
import type { Derived } from './derive';
import { angleTravelled, arcExtremes, fmt, TWO_PI, xyDist, type P3, type SheetMove } from './path';
import type { Push } from './rules';
import type { ExpectedPart } from './types';

export interface MatchOutcome {
  /** Operations matched completely, from the start of `ops`. */
  consumed: number;
  /** True when the whole read path was explained (no divergence). */
  ok: boolean;
}

function close3(a: P3, b: { x: number; y: number; z: number }, tol: number): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;
}

function describe(m: Move): string {
  const end = fmt(m);
  if (m.kind === 'rapid') return `rapid to ${end}`;
  if (m.kind === 'arc') {
    return `${m.direction.toUpperCase()} arc to ${end} centre (${m.cx.toFixed(4)}, ${m.cy.toFixed(4)}) F${m.feed}`;
  }
  return `${m.kind} to ${end} F${m.feed}`;
}

function describeRead(r: SheetMove): string {
  const end = fmt(r.to);
  if (r.kind === 'rapid') return `rapid to ${end}`;
  if (r.arc) {
    return `${r.arc.dir.toUpperCase()} arc to ${end} centre (${r.arc.cx.toFixed(4)}, ${r.arc.cy.toFixed(4)}) F${String(r.raw.feed)}`;
  }
  return `feed to ${end} F${String(r.raw.feed)}`;
}

/** Chord tolerance when the post does not declare one, mm. */
const CHORD_TOLERANCE = 0.01;

type Try = { ok: true; next: number } | { ok: false; at: number; why: string };

/**
 * Compares the read path with `ops` in order. `prefix`: the read path may end at an operation
 * boundary before the last operation (one file of a split program).
 */
export function matchModel(
  sm: readonly SheetMove[],
  ops: readonly Operation[],
  d: Derived,
  prefix: boolean,
  push: Push,
): MatchOutcome {
  const tol = d.posTol;
  const chordTol = d.ctx.post?.arcs?.chordTolerance ?? CHORD_TOLERANCE;
  const isExtra = (r: SheetMove): boolean =>
    r.kind === 'rapid' &&
    Math.abs(r.to.x - r.from.x) <= tol &&
    Math.abs(r.to.y - r.from.y) <= tol &&
    r.fromAssumed.includes('x') === r.toAssumed.includes('x') &&
    r.fromAssumed.includes('y') === r.toAssumed.includes('y') &&
    !r.toAssumed.includes('z') &&
    Math.abs(r.to.z - d.safeZ) <= tol;
  const feedOk = (r: SheetMove, feed: number) =>
    r.raw.feed !== null && Math.abs(r.raw.feed - feed) <= d.feedTol;

  const tryArc = (mv: Extract<Move, { kind: 'arc' }>, from: P3, ri: number): Try => {
    const R = Math.hypot(from.x - mv.cx, from.y - mv.cy);
    const a0 = Math.atan2(from.y - mv.cy, from.x - mv.cx);
    let sweep = angleTravelled(a0, Math.atan2(mv.y - mv.cy, mv.x - mv.cx), mv.direction);
    if (xyDist(from, mv) <= tol) sweep = TWO_PI;
    const angTol = tol / Math.max(R, tol);
    let prev = 0;
    for (let j = ri; j < sm.length; j++) {
      const r = sm[j];
      if (!r) break;
      if (r.kind === 'rapid') return { ok: false, at: j, why: 'rapid inside an arc' };
      if (r.arc) {
        if (r.arc.dir !== mv.direction) return { ok: false, at: j, why: 'arc direction differs' };
        if (Math.hypot(r.arc.cx - mv.cx, r.arc.cy - mv.cy) > tol) {
          return { ok: false, at: j, why: 'arc centre differs' };
        }
        if (Math.abs(r.arc.r - R) > tol) return { ok: false, at: j, why: 'arc radius differs' };
      }
      if (Math.abs(Math.hypot(r.to.x - mv.cx, r.to.y - mv.cy) - R) > tol) {
        return { ok: false, at: j, why: 'end point not on the model arc' };
      }
      if (!feedOk(r, mv.feed)) return { ok: false, at: j, why: 'feed differs' };
      let p = angleTravelled(a0, Math.atan2(r.to.y - mv.cy, r.to.x - mv.cx), mv.direction);
      if (p + angTol < prev || (p <= angTol && sweep > TWO_PI - angTol && prev > Math.PI))
        p += TWO_PI;
      if (p > sweep + angTol || p + angTol < prev) {
        return { ok: false, at: j, why: 'arc goes past the model end or backwards' };
      }
      if (r.arc && Math.abs(r.arc.sweep - (p - prev)) > 2 * angTol + 1e-9) {
        return { ok: false, at: j, why: 'arc piece sweeps a different angle' };
      }
      // A chord (arcs written as lines) may leave the arc by at most the chord tolerance.
      if (!r.arc && R * (1 - Math.cos((p - prev) / 2)) > chordTol + tol) {
        return {
          ok: false,
          at: j,
          why: 'chord leaves the model arc by more than the chord tolerance',
        };
      }
      const zWant = from.z + ((mv.z - from.z) * Math.min(p, sweep)) / sweep;
      if (Math.abs(r.to.z - zWant) > tol) return { ok: false, at: j, why: 'helix height differs' };
      prev = p;
      if (Math.abs(p - sweep) <= angTol && close3(r.to, mv, tol)) return { ok: true, next: j + 1 };
    }
    return { ok: false, at: sm.length, why: 'read path ends inside an arc' };
  };

  const tryMove = (mv: Move, from: P3 | null, ri: number): Try => {
    const r = sm[ri];
    if (!r) return { ok: false, at: ri, why: 'read path ends early' };
    if (mv.kind === 'arc') {
      if (!from) return { ok: false, at: ri, why: 'arc from an unknown model position' };
      return tryArc(mv, from, ri);
    }
    if (mv.kind === 'rapid' ? r.kind !== 'rapid' : r.kind !== 'feed') {
      return { ok: false, at: ri, why: 'move type differs' };
    }
    if (!close3(r.to, mv, tol)) return { ok: false, at: ri, why: 'end point differs' };
    if (mv.kind !== 'rapid' && !feedOk(r, mv.feed))
      return { ok: false, at: ri, why: 'feed differs' };
    return { ok: true, next: ri + 1 };
  };

  let ri = 0;
  let pos: P3 | null = null;
  const skipExtras = () => {
    while (ri < sm.length && isExtra(sm[ri] as SheetMove)) ri++;
  };
  const diverge = (op: Operation, n: number, mv: Move | null, at: number, why: string) => {
    const r = sm[at];
    push(
      'MODEL',
      'MODEL_MISMATCH',
      r?.line ?? 0,
      mv
        ? `Read path diverges from the model (${why}) at operation ${op.id} move ${n + 1}: expected ${describe(mv)}, read ${r ? describeRead(r) : 'nothing'}.`
        : `Read path diverges from the model (${why}): read ${r ? describeRead(r) : 'nothing'}.`,
    );
  };

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k] as Operation;
    if (prefix && k > 0) {
      skipExtras();
      if (ri >= sm.length) return { consumed: k, ok: true };
    }
    const moves = operationMoves(op);
    for (let n = 0; n < moves.length; n++) {
      const mv = moves[n] as Move;
      const tiny = pos !== null && mv.kind !== 'arc' && close3(pos, mv, tol);
      for (;;) {
        const t = tryMove(mv, pos, ri);
        if (t.ok) {
          for (let j = ri; j < t.next; j++) toolAndRpm(sm[j] as SheetMove, op, push);
          ri = t.next;
          break;
        }
        if (tiny) break;
        const r = sm[ri];
        if (r && isExtra(r)) {
          ri++;
          continue;
        }
        diverge(op, n, mv, t.at, t.why);
        return { consumed: k, ok: false };
      }
      pos = { x: mv.x, y: mv.y, z: mv.z };
    }
  }
  skipExtras();
  if (ri < sm.length) {
    const op = ops[ops.length - 1] as Operation;
    diverge(op, 0, null, ri, 'moves after the last operation');
    return { consumed: ops.length, ok: false };
  }
  return { consumed: ops.length, ok: true };
}

/** Per matched move: the active tool (when the program names it) and the spindle speed. */
function toolAndRpm(r: SheetMove, op: Operation, push: Push): void {
  if (r.kind === 'rapid') return;
  if (r.raw.tool !== null && r.raw.tool !== op.tool) {
    push(
      'TOOLS',
      'TOOL_MISMATCH',
      r.line,
      `Operation ${op.id} expects T${op.tool}, the spindle holds T${r.raw.tool}.`,
    );
  }
  if (r.raw.rpm !== null && Math.abs(r.raw.rpm - op.rpm) > 0.5) {
    push(
      'MODEL',
      'RPM_MISMATCH',
      r.line,
      `Operation ${op.id} expects S${op.rpm}, read S${r.raw.rpm}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Layout: closed through-cut loops and their centres
// ---------------------------------------------------------------------------

export interface CutLoop {
  /** Centre of the loop's bounding box (sheet frame). */
  cx: number;
  cy: number;
  line: number;
}

/**
 * Through cuts of the read path: each run of feed moves between rapids that reaches the target
 * depth. Its part loop is the longest closed stretch between two vertices at the deepest Z with
 * the same XY (the final pass from the start point back to it; leads and ramps stay outside). The
 * tool-centre loop is the outline offset by the tool radius, so its box centre is the outline's.
 */
export function cutLoops(sm: readonly SheetMove[], d: Derived, push: Push): CutLoop[] {
  const tol = d.posTol;
  const loops: CutLoop[] = [];
  let i = 0;
  while (i < sm.length) {
    if ((sm[i] as SheetMove).kind === 'rapid') {
      i++;
      continue;
    }
    const cut: SheetMove[] = [];
    while (i < sm.length && (sm[i] as SheetMove).kind !== 'rapid') cut.push(sm[i++] as SheetMove);
    const verts: P3[] = [(cut[0] as SheetMove).from, ...cut.map((m) => m.to)];
    const zMin = Math.min(...verts.map((v) => v.z));
    if (zMin > d.target + tol) continue;
    const cum = [0];
    cut.forEach((m, k) => {
      const len = m.arc ? m.arc.r * m.arc.sweep : xyDist(m.from, m.to);
      cum.push((cum[k] ?? 0) + len);
    });
    let best: [number, number] | null = null;
    let bestLen = 0;
    for (let a = 0; a < verts.length; a++) {
      const va = verts[a] as P3;
      if (Math.abs(va.z - zMin) > tol) continue;
      for (let b = a + 1; b < verts.length; b++) {
        const vb = verts[b] as P3;
        if (Math.abs(vb.z - zMin) > tol || xyDist(va, vb) > tol) continue;
        const len = (cum[b] ?? 0) - (cum[a] ?? 0);
        if (len > bestLen + tol) {
          best = [a, b];
          bestLen = len;
        }
      }
    }
    const first = cut[0] as SheetMove;
    const v0 = verts[0] as P3;
    if (!best && verts.every((v) => xyDist(v, v0) <= tol)) {
      // Straight down and up only: a drilled through hole (T139) at that XY.
      loops.push({ cx: v0.x, cy: v0.y, line: first.line });
      continue;
    }
    if (!best) {
      push(
        'LAYOUT',
        'CUT_NOT_CLOSED',
        first.line,
        'A through cut does not close into a loop: the part is not cut free.',
      );
      continue;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (p: { x: number; y: number }) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    };
    add(verts[best[0]] as P3);
    for (let k = best[0]; k < best[1]; k++) {
      const m = cut[k] as SheetMove;
      add(m.to);
      if (m.arc) arcExtremes(m.from, m.arc).forEach(add);
    }
    loops.push({
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      line: (cut[best[0]] as SheetMove).line,
    });
  }
  return loops;
}

/** Closed through cuts the layout expects: every placed copy plus each of its cut-outs (T134). */
export function expectedLoopCount(expected: readonly ExpectedPart[]): number {
  return expected.reduce(
    (n, e) =>
      n + (e.outlineCut === false ? 0 : 1) + (e.inners?.length ?? 0) + (e.holes?.length ?? 0),
    0,
  );
}

interface ExpectedLoop {
  part: ExpectedPart;
  /** Cut-out index; undefined = the part's outer contour. */
  inner?: number;
  /** Through-hole index (T139). */
  hole?: number;
  cx: number;
  cy: number;
}

/**
 * Every expected part, and every cut-out of every placed copy (T134), cut exactly once at its
 * place; nothing else cut through. A cut-out is a closed through cut at a known place inside its
 * copy (its expected centre turns and moves with the copy); any other loop is still an error.
 */
export function matchLayout(
  loops: readonly CutLoop[],
  expected: readonly ExpectedPart[],
  d: Derived,
  push: Push,
): void {
  const want: ExpectedLoop[] = expected.flatMap((part) => [
    ...(part.outlineCut === false ? [] : [{ part, cx: part.cx, cy: part.cy }]),
    ...(part.inners ?? []).map((c, inner) => ({ part, inner, cx: c.cx, cy: c.cy })),
    ...(part.holes ?? []).map((c, hole) => ({ part, hole, cx: c.cx, cy: c.cy })),
  ]);
  const free = new Set(want.map((_, i) => i));
  const extra: CutLoop[] = [];
  for (const l of loops) {
    let bestI = -1;
    let bestD = Infinity;
    for (const i of free) {
      const e = want[i] as ExpectedLoop;
      const dist = Math.hypot(e.cx - l.cx, e.cy - l.cy);
      if (dist < bestD) {
        bestD = dist;
        bestI = i;
      }
    }
    if (bestI >= 0 && bestD <= d.layoutTol) free.delete(bestI);
    else extra.push(l);
  }
  const outlines = expected.filter((e) => e.outlineCut !== false).length;
  const inners = want.length - outlines;
  if (loops.length !== want.length) {
    push(
      'LAYOUT',
      'PART_COUNT',
      0,
      inners === 0
        ? `The program cuts ${loops.length} parts, the layout has ${outlines}.`
        : `The program cuts ${loops.length} closed loops, the layout has ${outlines} parts and ${inners} cut-outs or through holes (${want.length}).`,
    );
  }
  for (const l of extra) {
    push(
      'LAYOUT',
      'PART_POSITION',
      l.line,
      `A part cut with centre (${l.cx.toFixed(3)}, ${l.cy.toFixed(3)}) is not at any expected placement.`,
    );
  }
  for (const i of free) {
    const e = want[i] as ExpectedLoop;
    const what =
      e.hole !== undefined
        ? `Through hole ${e.hole + 1} of part ${e.part.partId} copy ${e.part.copy}`
        : e.inner === undefined
          ? `Part ${e.part.partId} copy ${e.part.copy}`
          : `Cut-out ${e.inner + 1} of part ${e.part.partId} copy ${e.part.copy}`;
    push(
      'LAYOUT',
      'PART_MISSING',
      0,
      `${what} at (${e.cx.toFixed(3)}, ${e.cy.toFixed(3)}) is not cut.`,
    );
  }
}
