/**
 * Property (T019): random single-line mutations of generated programs, drawn from a mutation
 * catalogue (not blind fuzz). Each mutated program is either **safe-equivalent** to the original
 * (judged here independently of the checks: same read path within the check tolerances, same
 * machine state at every move, same tool changes, same end state) or it must be **caught**. The
 * catch rate over the non-equivalent mutations is reported (and must be 100 %).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readGcode, type GcodeReadResult } from '../gcode-reader';
import { checkGcodeFiles } from './check';
import { buildScenario, fileList, scenarioArb } from './scenario.testing';

type Mutator = (line: string, rnd: number) => string | null;

const NUM = /([XYZIJFSP])(-?\d+(?:\.\d+)?)/g;

function words(line: string): RegExpMatchArray[] {
  return [...line.matchAll(NUM)];
}

/** Replaces the k-th numeric word (k from `rnd`) with `f(letter, value, text)`. */
function onWord(line: string, rnd: number, f: (letter: string, v: number, text: string) => string): string | null {
  const ws = words(line);
  if (ws.length === 0) return null;
  const w = ws[Math.floor(rnd * ws.length) % ws.length];
  if (!w || w.index === undefined) return null;
  const letter = w[1] ?? '';
  const text = w[2] ?? '';
  const out = line.slice(0, w.index) + f(letter, Number(text), text) + line.slice(w.index + w[0].length);
  return out === line ? null : out;
}

function decimals(text: string): number {
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
}

/** The catalogue of single-line mutators (one line in, one line or nothing out). */
const LINE_MUTATORS: Record<string, Mutator> = {
  perturbTiny: (l, r) => onWord(l, r, (k, v, t) => `${k}${(v + 0.0004).toFixed(Math.max(decimals(t), 4))}`),
  perturbSmall: (l, r) => onWord(l, r, (k, v, t) => `${k}${(v + 0.02).toFixed(Math.max(decimals(t), 2))}`),
  perturbLarge: (l, r) => onWord(l, r, (k, v, t) => `${k}${(v + 7).toFixed(decimals(t))}`),
  negate: (l, r) => onWord(l, r, (k, v, t) => `${k}${(-v).toFixed(decimals(t))}`),
  zeroValue: (l, r) => onWord(l, r, (k, _v, t) => `${k}${(0).toFixed(decimals(t))}`),
  exponent: (l, r) => onWord(l, r, (k, v) => `${k}${v.toExponential(2)}`),
  dropWord: (l, r) => {
    const ws = l.split(' ');
    if (ws.length < 2) return null;
    const i = Math.floor(r * ws.length) % ws.length;
    return ws.filter((_, k) => k !== i).join(' ');
  },
  rapidToFeed: (l) => (/^G0 /.test(l) ? l.replace(/^G0 /, 'G1 ') : null),
  feedToRapid: (l) => (/^G1 /.test(l) ? l.replace(/^G1 /, 'G0 ').replace(/ F\d+(\.\d+)?/, '') : null),
  flipArc: (l) => (/^G[23] /.test(l) ? l.replace(/^G([23])/, (_, d: string) => (d === '2' ? 'G3' : 'G2')) : null),
  addUnknown: (l) => (l.startsWith('(') ? null : `${l} Q1`),
  deleteLine: () => '',
};

/** Whole-line mutators (insert, duplicate, swap). */
const INSERTS = ['M5', 'G91', 'G0 Z0', 'M30', 'G20', 'G4 P1', 'M9', 'M3 S9000', 'G0 X0 Y0'];

type Op =
  | { kind: 'line'; name: keyof typeof LINE_MUTATORS }
  | { kind: 'insert'; text: string }
  | { kind: 'duplicate' }
  | { kind: 'swap' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...(Object.keys(LINE_MUTATORS) as (keyof typeof LINE_MUTATORS)[])).map((name) => ({ kind: 'line' as const, name })) },
  { weight: 2, arbitrary: fc.constantFrom(...INSERTS).map((text) => ({ kind: 'insert' as const, text })) },
  { weight: 1, arbitrary: fc.constant({ kind: 'duplicate' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'swap' as const }) },
);

function mutate(lines: string[], op: Op, at: number, rnd: number): string[] | null {
  const i = at % lines.length;
  const l = lines[i] ?? '';
  if (op.kind === 'line') {
    const m = LINE_MUTATORS[op.name]?.(l, rnd);
    if (m === null || m === undefined) return null;
    return m === '' ? lines.filter((_, k) => k !== i) : lines.map((x, k) => (k === i ? m : x));
  }
  if (op.kind === 'insert') return [...lines.slice(0, i), op.text, ...lines.slice(i)];
  if (op.kind === 'duplicate') return [...lines.slice(0, i + 1), l, ...lines.slice(i + 1)];
  if (i + 1 >= lines.length) return null;
  const out = [...lines];
  out[i] = lines[i + 1] ?? '';
  out[i + 1] = l;
  return out;
}

interface Snapshot {
  type: string;
  x: number;
  y: number;
  z: number;
  cx: number | null;
  cy: number | null;
  feed: number | null;
  spindle: boolean;
  rpm: number | null;
  tool: number | null;
  warmedUp: boolean;
  vacuum: boolean;
  /** Units, distance, arc distance, plane, work offset of the move's line. */
  modal: string;
}

/**
 * The machine-relevant meaning of a program, independently of the checks: per move (zero-length
 * moves dropped: they do nothing) its end, arc centre, feed, modal state and, for cutting moves,
 * the spindle/tool/warm-up/vacuum state; plus the tool-change sequence, pauses, the end state and
 * the reader's errors.
 */
function meaning(r: GcodeReadResult, warmup: number, tol: number) {
  let dwell = 0;
  let vacuum = false;
  let ei = 0;
  const moves: Snapshot[] = [];
  const apply = (upTo: number) => {
    while (ei < r.events.length && (r.events[ei]?.moveIndex ?? Infinity) <= upTo) {
      const e = r.events[ei++];
      if (!e) continue;
      if (e.kind === 'spindle' && e.state !== 'off') dwell = 0;
      if (e.kind === 'dwell') dwell += e.seconds;
      if (e.kind === 'coolant') vacuum = e.state !== 'off';
    }
  };
  r.moves.forEach((m, i) => {
    apply(i);
    const zero =
      !m.arc &&
      Math.abs(m.to.x - m.from.x) <= tol &&
      Math.abs(m.to.y - m.from.y) <= tol &&
      Math.abs(m.to.z - m.from.z) <= tol &&
      m.assumedAxes.join() === (r.moves[i - 1]?.assumedAxes ?? ['x', 'y', 'z']).join();
    if (zero) return;
    const st = r.lines[m.line - 1]?.state;
    const cut = m.type !== 'rapid';
    moves.push({
      modal: st ? `${st.units} ${st.distance} ${st.arcDistance} ${st.plane} ${st.wcs}` : '',
      type: m.type,
      ...m.to,
      cx: m.arc?.cx ?? null,
      cy: m.arc?.cy ?? null,
      feed: m.feed,
      spindle: cut ? m.spindleOn : true,
      rpm: cut ? m.rpm : null,
      tool: cut ? m.tool : null,
      warmedUp: cut ? dwell >= warmup - 1e-9 : true,
      vacuum: cut ? vacuum : true,
    });
  });
  apply(Infinity);
  return {
    errors: r.errors.length,
    moves,
    tools: r.events.filter((e) => e.kind === 'toolChange').map((e) => (e.kind === 'toolChange' ? e.tool : null)),
    pauses: r.events.filter((e) => e.kind === 'pause').length,
    end: { spindle: r.finalState.spindle, vacuum, ended: r.finalState.ended },
  };
}

function segDist(p: Snapshot, a: Snapshot, b: Snapshot): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

/** Chord tolerance of both shipped posts (a deleted chord vertex within it changes nothing). */
const CHORD_TOL = 0.01;

function sameMove(m: Snapshot, n: Snapshot | undefined, tol: number, ftol: number): boolean {
  const near = (p: number | null, q: number | null, t: number) =>
    p === null || q === null ? p === q : Math.abs(p - q) <= t;
  return (
    n !== undefined &&
    m.type === n.type &&
    near(m.x, n.x, tol) &&
    near(m.y, n.y, tol) &&
    near(m.z, n.z, tol) &&
    near(m.cx, n.cx, tol) &&
    near(m.cy, n.cy, tol) &&
    near(m.feed, n.feed, ftol) &&
    m.spindle === n.spindle &&
    near(m.rpm, n.rpm, 0.5) &&
    m.tool === n.tool &&
    m.warmedUp === n.warmedUp &&
    m.vacuum === n.vacuum &&
    m.modal === n.modal
  );
}

/**
 * Safe-equivalent: same meaning within the tolerances; or one straight cut vertex removed whose
 * point lies within the chord tolerance of the merged segment (a chord of an arc written as lines).
 */
function equivalent(a: ReturnType<typeof meaning>, b: ReturnType<typeof meaning>, tol: number, ftol: number): boolean {
  if (a.errors !== b.errors || b.errors > 0) return false;
  if (JSON.stringify(a.tools) !== JSON.stringify(b.tools) || a.pauses !== b.pauses) return false;
  if (JSON.stringify(a.end) !== JSON.stringify(b.end)) return false;
  if (a.moves.length === b.moves.length) {
    const diff = a.moves.flatMap((m, i) => (sameMove(m, b.moves[i], tol, ftol) ? [] : [i]));
    if (diff.length === 0) return true;
    // One straight cut vertex moved within the chord tolerance of the original path.
    const k = diff[0] ?? -1;
    const o = a.moves[k];
    const n = b.moves[k];
    const prev = a.moves[k - 1];
    const next = a.moves[k + 1];
    if (diff.length !== 1 || !o || !n || !prev || !next || o.type !== 'feed' || next.type !== 'feed') return false;
    if (!sameMove({ ...o, x: n.x, y: n.y, z: n.z }, n, tol, ftol) || Math.abs(o.z - n.z) > tol) return false;
    return Math.min(segDist(n, prev, o), segDist(n, o, next)) <= CHORD_TOL;
  }
  if (a.moves.length !== b.moves.length + 1) return false;
  let k = 0;
  while (k < b.moves.length && sameMove(a.moves[k] as Snapshot, b.moves[k], tol, ftol)) k++;
  const gone = a.moves[k];
  const prev = a.moves[k - 1];
  const next = a.moves[k + 1];
  if (!gone || !prev || !next || gone.type !== 'feed' || next.type !== 'feed') return false;
  if (!a.moves.slice(k + 1).every((m, i) => sameMove(m, b.moves[k + i], tol, ftol))) return false;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((gone.x - prev.x) * dx + (gone.y - prev.y) * dy) / len2));
  const off = Math.hypot(prev.x + t * dx - gone.x, prev.y + t * dy - gone.y);
  const zOff = Math.abs(prev.z + t * (next.z - prev.z) - gone.z);
  return off <= CHORD_TOL && zOff <= tol;
}

describe('random single-line mutations are caught or harmless', () => {
  it('catch rate over non-equivalent mutations is 100 %', () => {
    const stats = { total: 0, equivalent: 0, equivalentFlagged: 0, nonEquivalent: 0, caught: 0 };
    const byOp = new Map<string, { n: number; caught: number; eq: number }>();
    const missed: string[] = [];
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => s.files === 'normal'),
        fc.array(
          fc.tuple(opArb, fc.nat({ max: 1_000_000 }), fc.double({ min: 0, max: 0.999, noNaN: true })),
          { minLength: 5, maxLength: 5 },
        ),
        (s, ops) => {
          const b = buildScenario(s);
          fc.pre(b !== null && b.result.ok && b.result.files.length === 1);
          if (!b) return;
          const file = b.result.files[0];
          if (!file) return;
          const opts = { dwellUnit: 's' as const, extraMCodes: [] };
          const lines = file.content.replace(/\r\n$/, '').split('\r\n');
          const decs = b.post.decimals;
          const tol = Math.max(0.002, 5 * 10 ** -Math.min(decs.xy, decs.z, decs.arc));
          const orig = meaning(readGcode(file.content, opts), b.profile.spindle.warmupSeconds, tol);
          for (const [op, at, rnd] of ops) {
            const out = mutate(lines, op, at, rnd);
            if (!out) continue;
            const text = `${out.join('\r\n')}\r\n`;
            if (text === file.content) continue;
            stats.total++;
            const name = op.kind === 'line' ? op.name : op.kind === 'insert' ? `insert ${op.text}` : op.kind;
            const entry = byOp.get(name) ?? { n: 0, caught: 0, eq: 0 };
            entry.n++;
            byOp.set(name, entry);
            const caught = !checkGcodeFiles([{ ...fileList([file])[0]!, content: text }], b.context).ok;
            const eq = equivalent(orig, meaning(readGcode(text, opts), b.profile.spindle.warmupSeconds, tol), tol, 0.5 + 1e-9);
            if (eq) {
              stats.equivalent++;
              entry.eq++;
              if (caught) stats.equivalentFlagged++;
              continue;
            }
            stats.nonEquivalent++;
            if (caught) {
              stats.caught++;
              entry.caught++;
            } else {
              const i = at % lines.length;
              missed.push(`${name} at line ${i + 1} "${lines[i]}"`);
            }
          }
        },
      ),
      { numRuns: Number(process.env.FC_RUNS ?? 120) },
    );
    const rate = stats.nonEquivalent === 0 ? 1 : stats.caught / stats.nonEquivalent;
    console.log(
      `mutation catch rate: ${stats.caught}/${stats.nonEquivalent} = ${(rate * 100).toFixed(1)} % ` +
        `(total ${stats.total}, safe-equivalent ${stats.equivalent}, of which flagged anyway ${stats.equivalentFlagged})`,
    );
    for (const [k, v] of [...byOp.entries()].sort()) {
      console.log(`  ${k.padEnd(14)} n=${v.n} caught=${v.caught} equivalent=${v.eq}`);
    }
    expect(missed).toEqual([]);
    expect(stats.nonEquivalent).toBeGreaterThan(200);
  }, 300_000);
});
