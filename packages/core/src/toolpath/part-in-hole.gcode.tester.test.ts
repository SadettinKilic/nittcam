/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester (B23, T166/T167, G-code safety of part-in-hole): a host part with a rectangular cut-out and
 * small guest parts nested inside it go through nest → toolpath → post → G-code TEXT, re-read by the
 * independent reader. Checked on the read moves only:
 * - every guest is cut COMPLETELY (all depth passes) before the host's cut-out contour, and the
 *   host's cut-out before its outer contour;
 * - no cutting move leaves the sheet; guests keep >= tool Ø + gap between footprints and to the cut-out;
 * - the independent checker rejects the wrong order (guest block swapped behind the cut-out block);
 * - true-shape is deterministic: the same input twice gives byte-identical G-code.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkGcode } from '../gcode-check';
import { postConfig } from '../gcode-check/check.testing';
import { opBlocks } from '../gcode-check/mutations.testing';
import { exportNc } from '../export/export';
import { readGcode } from '../gcode-reader';
import { bbox } from '../geometry/polyline';
import { nestProject, nestingEngineOf } from '../nesting';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './index';
import { placedInners, placedOutline } from './build';

const D = 8;
const R = D / 2;
const GAP = 4;
const MARGIN = 12;
const profile = goldenProfile('generic');
const pv = { profile, version: 1, verification: 'draft' as const };
const rect = (w: number, h: number, x = 0, y = 0) => [
  { x, y, bulge: 0 },
  { x: x + w, y, bulge: 0 },
  { x: x + w, y: y + h, bulge: 0 },
  { x, y: y + h, bulge: 0 },
];

function make(guests: { w: number; h: number; qty: number }[], tabs: boolean): Project {
  const base = {
    grain: { mode: 'free', angle: 0 },
    kind: 'rect',
    holes: [],
    templates: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const parsed = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 640, height: 540, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        ...base,
        id: 'host',
        name: 'host',
        qty: 1,
        params: { w: 600, h: 500, r: 0 },
        inners: [rect(400, 300, 100, 100)],
      },
      ...guests.map((g, i) => ({
        ...base,
        id: `g${i}`,
        name: `g${i}`,
        qty: g.qty,
        params: { w: g.w, h: g.h, r: 0 },
        inners: [],
      })),
    ],
    nesting: { mode: 'minWaste', gap: GAP, margin: MARGIN, partInHole: true },
    layout: { sheets: [] },
    cutting: { tabs: { auto: tabs }, leadIn: 'line', direction: 'climb' },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { ...parsed.project, layout: nestProject(parsed.project, { toolDiameter: D }).layout };
}

type Pt = { x: number; y: number };
type Box = ReturnType<typeof bbox>;
const rectDist = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a.minX - b.maxX, b.minX - a.maxX),
    Math.max(0, a.minY - b.maxY, b.minY - a.maxY),
  );
/** Distance from p to the boundary of box. */
function edgeDist(p: Pt, b: Box): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y);
}
const outsideBox = (p: Pt, b: Box) => p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY;

/** Cutting runs of a read program, classified by geometry: guest / hole / outer. */
function runs(text: string, host: Box, hole: Box) {
  const res = readGcode(text);
  const out: { cls: 'guest' | 'hole' | 'outer'; first: number; pts: Pt[] }[] = [];
  let cur: { pts: Pt[]; first: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const pts = cur.pts;
    const dHole = Math.min(...pts.map((p) => edgeDist(p, hole)));
    out.push({
      cls: pts.some((p) => outsideBox(p, host)) ? 'outer' : dHole < 6 ? 'hole' : 'guest',
      first: cur.first,
      pts,
    });
    cur = null;
  };
  for (const m of res.moves) {
    const cutting =
      m.type !== 'rapid' &&
      m.from.z < 0 &&
      m.to.z < 0 &&
      (m.from.x !== m.to.x || m.from.y !== m.to.y || m.arc !== undefined);
    if (!cutting) {
      if (m.type === 'rapid' || m.to.z >= 0) flush();
      continue;
    }
    cur ??= { pts: [], first: m.line };
    cur.pts.push({ x: m.from.x, y: m.from.y }, { x: m.to.x, y: m.to.y });
    if (m.arc) {
      const { cx, cy, radius } = m.arc;
      const a0 = Math.atan2(m.from.y - cy, m.from.x - cx);
      const s = m.arc.direction === 'ccw' ? 1 : -1;
      for (let i = 1; i < 16; i++) {
        const t = a0 + (s * m.arc.sweep * i) / 16;
        cur.pts.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) });
      }
    }
  }
  flush();
  return out;
}

function analyse(project: Project) {
  const pl = project.layout.sheets[0]!.placements;
  const hostPl = pl.find((p) => p.partId === 'host')!;
  const hostPart = project.parts.find((p) => p.id === 'host')!;
  const host = bbox(placedOutline(hostPart, hostPl));
  const hole = bbox(placedInners(hostPart, hostPl)[0]!);
  const guests = pl
    .filter((p) => p.partId !== 'host')
    .map((p) =>
      bbox(
        placedOutline(
          project.parts.find((q) => q.id === p.partId)!,
          p,
        ),
      ),
    );
  return { host, hole, guests };
}

const guestSpec = fc.array(
  fc.record({
    w: fc.integer({ min: 40, max: 140 }),
    h: fc.integer({ min: 40, max: 120 }),
    qty: fc.integer({ min: 1, max: 3 }),
  }),
  { minLength: 1, maxLength: 3 },
);

describe('part-in-hole G-code order (T166, property)', () => {
  it('guests cut completely before the cut-out, the cut-out before the host outline; clearances hold', () => {
    fc.assert(
      fc.property(guestSpec, fc.boolean(), (g, tabs) => {
        const project = make(g, tabs);
        expect(nestingEngineOf(project)).toBe('trueShape');
        const { host, hole, guests } = analyse(project);
        fc.pre(guests.length > 0);
        for (const [i, a] of guests.entries()) {
          for (const b of guests.slice(i + 1))
            expect(rectDist(a, b)).toBeGreaterThanOrEqual(D + GAP - 1e-6);
        }
        const inHole = guests.filter(
          (b) =>
            b.minX > hole.minX && b.maxX < hole.maxX && b.minY > hole.minY && b.maxY < hole.maxY,
        );
        for (const b of inHole) {
          expect(
            Math.min(
              b.minX - hole.minX,
              hole.maxX - b.maxX,
              b.minY - hole.minY,
              hole.maxY - b.maxY,
            ),
          ).toBeGreaterThanOrEqual(D + GAP - 1e-6);
        }
        fc.pre(inHole.length > 0);
        const r = exportNc(project, pv, postConfig('generic'));
        expect(
          r.ok,
          JSON.stringify(r.check?.violations?.slice(0, 3) ?? r.toolpathIssues.slice(0, 3)),
        ).toBe(true);
        const rs = runs(r.files[0]!.content, host, hole);
        const guestRuns = rs.filter((x) => x.cls === 'guest');
        const holeRuns = rs.filter((x) => x.cls === 'hole');
        const hostOuter = rs.filter(
          (x) => x.cls === 'outer' && x.pts.some((p) => Math.abs(edgeDist(p, host) - R) < 0.05),
        );
        expect(holeRuns.length).toBeGreaterThan(0);
        expect(hostOuter.length).toBeGreaterThan(0);
        expect(guestRuns.length).toBeGreaterThanOrEqual(inHole.length);
        expect(Math.max(...guestRuns.map((x) => x.first))).toBeLessThan(
          Math.min(...holeRuns.map((x) => x.first)),
        );
        expect(Math.max(...holeRuns.map((x) => x.first))).toBeLessThan(
          Math.min(...hostOuter.map((x) => x.first)),
        );
        for (const x of rs)
          for (const p of x.pts) {
            expect(p.x).toBeGreaterThanOrEqual(-1e-6);
            expect(p.y).toBeGreaterThanOrEqual(-1e-6);
            expect(p.x).toBeLessThanOrEqual(640 + 1e-6);
            expect(p.y).toBeLessThanOrEqual(540 + 1e-6);
          }
      }),
      { numRuns: 15 },
    );
  });

  it('the independent checker rejects the wrong order (guest block behind the cut-out)', () => {
    const project = make([{ w: 100, h: 80, qty: 1 }], false);
    const { host, hole } = analyse(project);
    const r = exportNc(project, pv, postConfig('generic'));
    expect(r.ok).toBe(true);
    const text = r.files[0]!.content;
    const lines = text.split(/\r?\n/);
    const blocks = opBlocks(lines);
    const kind = (b: [number, number]) => {
      const xy = lines.slice(b[0], b[1] + 1).flatMap((l) => {
        const x = /X(-?[\d.]+)/.exec(l);
        const y = /Y(-?[\d.]+)/.exec(l);
        return x && y ? [{ x: Number(x[1]), y: Number(y[1]) }] : [];
      });
      if (xy.some((p) => outsideBox(p, host))) return 'outer';
      return Math.min(...xy.map((p) => edgeDist(p, hole))) < 6 ? 'hole' : 'guest';
    };
    const ks = blocks.map(kind);
    const gi = ks.indexOf('guest');
    const hi = ks.indexOf('hole');
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThan(gi);
    const [g0, g1] = blocks[gi]!;
    const [h0, h1] = blocks[hi]!;
    const swapped = [
      ...lines.slice(0, g0),
      ...lines.slice(h0, h1 + 1),
      ...lines.slice(g1 + 1, h0),
      ...lines.slice(g0, g1 + 1),
      ...lines.slice(h1 + 1),
    ].join('\r\n');
    const tp = buildToolpath(project, profile);
    const ctx = {
      profile,
      verification: 'draft' as const,
      post: postConfig('generic'),
      toolpath: tp.toolpath,
      stock: { thickness: 18, sheetWidth: 640, sheetHeight: 540 },
      sheet: 0,
    };
    expect(checkGcode(text, ctx as never).violations).toEqual([]);
    expect(checkGcode(swapped, ctx as never).violations.length).toBeGreaterThan(0);
  });

  it('deterministic: the same job twice gives byte-identical G-code', () => {
    const g = [
      { w: 90, h: 70, qty: 2 },
      { w: 60, h: 120, qty: 1 },
    ];
    const a = exportNc(make(g, true), pv, postConfig('generic'));
    const b = exportNc(make(g, true), pv, postConfig('generic'));
    expect(a.ok && b.ok).toBe(true);
    expect(a.files.map((f) => f.content)).toEqual(b.files.map((f) => f.content));
  });
});
