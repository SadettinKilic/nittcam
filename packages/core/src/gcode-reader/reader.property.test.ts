/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Property tests of the G-code reader (T018): random valid programs from a small grammar; the read
 * endpoints equal the generated ones and every arc is radius-consistent. Plus a fuzz test: the
 * reader never throws and never returns non-finite coordinates.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sampleMove } from './arc';
import { toComparablePath } from './comparable';
import { readGcode } from './reader';

interface Expected {
  type: 'rapid' | 'feed' | 'arcCw' | 'arcCcw';
  x: number;
  y: number;
  z: number;
  /** Generated arc centre and radius. */
  cx?: number;
  cy?: number;
  r?: number;
  form?: 'ij' | 'r';
}

const fmt = (v: number): string => v.toFixed(3);
const num = (s: string): number => Number(s);

type Step =
  | { kind: 'line'; rapid: boolean; x: number; y: number; z: number; omit: boolean[] }
  | { kind: 'inc'; dx: number; dy: number; dz: number }
  | {
      kind: 'arc';
      cw: boolean;
      r: number;
      centreAngle: number;
      sweep: number;
      dz: number;
      form: 'ijInc' | 'ijAbs' | 'r';
    };

const coord = fc.integer({ min: -500_000, max: 500_000 }).map((v) => v / 1000);
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('line' as const),
    rapid: fc.boolean(),
    x: coord,
    y: coord,
    z: fc.integer({ min: -20_000, max: 50_000 }).map((v) => v / 1000),
    omit: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('inc' as const),
    dx: coord,
    dy: coord,
    dz: fc.integer({ min: -5000, max: 5000 }).map((v) => v / 1000),
  }),
  fc.record({
    kind: fc.constant('arc' as const),
    cw: fc.boolean(),
    r: fc.integer({ min: 1000, max: 400_000 }).map((v) => v / 1000),
    centreAngle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    // Sweeps away from 0, π and 2π, where R arcs are ill-conditioned.
    sweep: fc.oneof(
      fc.double({ min: 0.3, max: Math.PI - 0.3, noNaN: true }),
      fc.double({ min: Math.PI + 0.3, max: 2 * Math.PI - 0.3, noNaN: true }),
    ),
    dz: fc.constantFrom(0, 0, -1.5),
    form: fc.constantFrom('ijInc' as const, 'ijAbs' as const, 'r' as const),
  }),
);

interface Program {
  text: string;
  expected: Expected[];
}

function buildProgram(steps: Step[], style: { lower: boolean; compact: boolean; crlf: boolean }) {
  const out: string[] = [];
  const expected: Expected[] = [];
  const w = (...words: string[]): void => {
    let line = words.join(style.compact ? '' : ' ');
    if (style.lower) line = line.toLowerCase();
    out.push(line);
  };
  let arcMode: 'G90.1' | 'G91.1' = 'G91.1';
  let motion = '';
  w('G21', 'G90', 'G17', 'G54', 'F1000');
  const p = { x: 0, y: 0, z: 10 };
  w('G0', 'X0.000', 'Y0.000', 'Z10.000');
  motion = 'G0';
  expected.push({ type: 'rapid', ...p });

  for (const s of steps) {
    if (s.kind === 'line') {
      const g = s.rapid ? 'G0' : 'G1';
      const words: string[] = [];
      if (g !== motion) words.push(g);
      motion = g;
      const xs = fmt(s.x);
      const ys = fmt(s.y);
      const zs = fmt(s.z);
      if (!s.omit[0]) {
        words.push('X' + xs);
        p.x = num(xs);
      }
      if (!s.omit[1]) {
        words.push('Y' + ys);
        p.y = num(ys);
      }
      if (!s.omit[2] || words.every((x) => !/^[XYZ]/.test(x))) {
        words.push('Z' + zs);
        p.z = num(zs);
      }
      w(...words);
      expected.push({ type: s.rapid ? 'rapid' : 'feed', ...p });
    } else if (s.kind === 'inc') {
      w('G91');
      const xs = fmt(s.dx);
      const ys = fmt(s.dy);
      const zs = fmt(s.dz);
      w('G1', 'X' + xs, 'Y' + ys, 'Z' + zs);
      motion = 'G1';
      // Same float operations as the reader: position + written value.
      p.x = p.x + num(xs);
      p.y = p.y + num(ys);
      p.z = p.z + num(zs);
      w('G90');
      expected.push({ type: 'feed', ...p });
    } else {
      // Centre at distance r from the current point; rounded to the written precision.
      const cx = num(fmt(p.x + s.r * Math.cos(s.centreAngle)));
      const cy = num(fmt(p.y + s.r * Math.sin(s.centreAngle)));
      const r0 = Math.hypot(p.x - cx, p.y - cy);
      const a0 = Math.atan2(p.y - cy, p.x - cx);
      const a1 = a0 + (s.cw ? -1 : 1) * s.sweep;
      const xs = fmt(cx + r0 * Math.cos(a1));
      const ys = fmt(cy + r0 * Math.sin(a1));
      const zs = fmt(p.z + s.dz);
      const g = s.cw ? 'G2' : 'G3';
      const words = [g, 'X' + xs, 'Y' + ys, 'Z' + zs];
      if (s.form === 'r') {
        words.push('R' + fmt(s.sweep > Math.PI ? -r0 : r0));
      } else {
        const want = s.form === 'ijAbs' ? 'G90.1' : 'G91.1';
        if (want !== arcMode) {
          w(want);
          arcMode = want;
        }
        if (s.form === 'ijAbs') words.push('I' + fmt(cx), 'J' + fmt(cy));
        else words.push('I' + fmt(cx - p.x), 'J' + fmt(cy - p.y));
      }
      w(...words);
      motion = g;
      p.x = num(xs);
      p.y = num(ys);
      p.z = num(zs);
      expected.push({
        type: s.cw ? 'arcCw' : 'arcCcw',
        ...p,
        cx,
        cy,
        r: r0,
        form: s.form === 'r' ? 'r' : 'ij',
      });
    }
  }
  w('M30');
  return { text: out.join(style.crlf ? '\r\n' : '\n') + (style.crlf ? '\r\n' : '\n'), expected };
}

const programArb: fc.Arbitrary<Program> = fc
  .tuple(
    fc.array(stepArb, { minLength: 1, maxLength: 40 }),
    fc.record({ lower: fc.boolean(), compact: fc.boolean(), crlf: fc.boolean() }),
  )
  .map(([steps, style]) => buildProgram(steps, style));

describe('readGcode property: generated programs', () => {
  it('read endpoints equal the generated ones; arcs are radius-consistent', () => {
    fc.assert(
      fc.property(programArb, ({ text, expected }) => {
        const r = readGcode(text);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.moves).toHaveLength(expected.length);
        r.moves.forEach((m, i) => {
          const e = expected[i]!;
          expect(m.type).toBe(e.type);
          expect(m.to.x).toBeCloseTo(e.x, 9);
          expect(m.to.y).toBeCloseTo(e.y, 9);
          expect(m.to.z).toBeCloseTo(e.z, 9);
          if (i > 0) expect(m.from).toEqual(r.moves[i - 1]!.to);
          if (e.cx !== undefined) {
            const a = m.arc!;
            expect(a.form).toBe(e.form);
            const rs = Math.hypot(m.from.x - a.cx, m.from.y - a.cy);
            const re = Math.hypot(m.to.x - a.cx, m.to.y - a.cy);
            // Endpoints are rounded to 3 decimals: radius consistent within the tolerance.
            expect(Math.abs(rs - re)).toBeLessThanOrEqual(0.01);
            expect(Math.abs(a.radius - e.r!)).toBeLessThanOrEqual(0.005);
            const centreTol = e.form === 'r' ? 0.05 : 1e-6;
            expect(Math.abs(a.cx - e.cx)).toBeLessThanOrEqual(centreTol);
            expect(Math.abs(a.cy - e.cy!)).toBeLessThanOrEqual(centreTol);
            // Sampled points stay on the circle and end at the end point.
            const pts = sampleMove(m, 0.05);
            expect(pts.at(-1)).toEqual(m.to);
            for (const q of pts) {
              expect(Math.abs(Math.hypot(q.x - a.cx, q.y - a.cy) - a.radius)).toBeLessThan(0.011);
            }
          }
        });
        const cmp = toComparablePath(r.moves);
        expect(cmp.moves.map((c) => [c.x, c.y, c.z])).toEqual(
          r.moves.map((m) => [m.to.x, m.to.y, m.to.z]),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(programArb, ({ text }) => {
        expect(readGcode(text)).toEqual(readGcode(text));
      }),
      { numRuns: 50 },
    );
  });
});

describe('readGcode fuzz', () => {
  const alphabet = 'GMXYZIJKRFSTPN0123456789.-+ ()%;/\r\neE#[]abcxyz';
  it('never throws; every move coordinate is finite', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom(...alphabet.split('')), { maxLength: 300 })
          .map((cs) => cs.join('')),
        (text) => {
          const r = readGcode(text);
          for (const m of r.moves) {
            for (const v of [m.from.x, m.from.y, m.from.z, m.to.x, m.to.y, m.to.z]) {
              expect(Number.isFinite(v)).toBe(true);
            }
          }
          expect(r.ok).toBe(r.errors.length === 0);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
