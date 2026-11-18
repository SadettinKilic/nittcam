/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester (B5, T113/T114, G-code safety): parts at arbitrary angles go through toolpath → post →
 * G-code TEXT, and the text is re-read by the independent reader. Everything below is checked on
 * the read moves only (not on the toolpath objects):
 * - the export passes every automatic check (spec §7.2) with zero violations, generic and mach3;
 * - every cutting move stays inside the sheet and OUTSIDE the rotated part by ≥ tool radius
 *   (compensation side), and the cut covers the whole rotated outline at tool radius;
 * - each depth pass closes (the contour is a loop), its turning direction is the same as at 0°;
 * - every rapid that changes X/Y runs above the material top (no rapid through parts);
 * - arcs: the reader's radius check passes and every arc sample sits at tool radius (corners
 *   stay corners after rotation);
 * - a grain-30° nested layout cuts no neighbour.
 */
import { describe, expect, it } from 'vitest';
import { canDownload } from '../gcode-check';
import { golden, postConfig } from '../gcode-check/check.testing';
import { exportNc } from '../export/export';
import { readGcode, type GcodeMove } from '../gcode-reader';
import { bbox, forEachSegment, signedArea } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Polyline } from '../geometry/types';
import { allowedRotations } from '../geometry/grain';
import { nestProject } from '../nesting';
import type { Project } from '../schema';
import { placedOutline } from './build';

type PostId = 'generic' | 'mach3';
const ANGLES = [0.001, 1, 30, 45, 60, 89.999, 90.001, 135, 179.999, 200.5, 270.001, 315, 359.999];
const TOOL_R = 4; // golden profile: D8
/** Post rounding (3–4 decimals) plus offset/arc noise. */
const TOL = 0.005;

function setUp(rot: number, post: PostId): { project: Project; pv: never } {
  const g = golden(post, 'shelf-set');
  const part = g.project.parts[0]!;
  // Centre the rotated bbox on the sheet.
  const box = bbox(placedOutline(part, { x: 0, y: 0, rot }));
  const { width, height } = g.project.stock.sheet;
  const x = Math.round((width - (box.maxX - box.minX)) / 2);
  const y = Math.round((height - (box.maxY - box.minY)) / 2);
  const project: Project = {
    ...g.project,
    parts: [{ ...part, qty: 1 }],
    layout: { sheets: [{ placements: [{ partId: part.id, index: 0, x, y, rot, locked: false }] }] },
  };
  const pv = { profile: g.context.profile, version: 1, verification: 'draft' as const };
  return { project, pv: pv as never };
}

function samplePoly(poly: Polyline, steps = 24): Point[] {
  const pts: Point[] = [];
  forEachSegment(poly, (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, steps);
    if (s.length === 2) {
      // Lines: sample every ~5 mm.
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
      for (let i = 0; i <= n; i++)
        pts.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
    } else pts.push(...s);
  });
  return pts;
}

/** Points along a read move in the XY plane (lines every ~5 mm, arcs every ~2°). */
function sampleMove(m: GcodeMove): Point[] {
  if (m.arc) {
    const { cx, cy, radius, sweep, direction } = m.arc;
    const a0 = Math.atan2(m.from.y - cy, m.from.x - cx);
    const sgn = direction === 'ccw' ? 1 : -1;
    const n = Math.max(2, Math.ceil(sweep / (Math.PI / 90)));
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = a0 + (sgn * sweep * i) / n;
      return { x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) };
    });
  }
  const n = Math.max(1, Math.ceil(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) / 5));
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: m.from.x + ((m.to.x - m.from.x) * i) / n,
    y: m.from.y + ((m.to.y - m.from.y) * i) / n,
  }));
}

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from p to a densely sampled closed outline. */
function distTo(p: Point, ring: readonly Point[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++)
    d = Math.min(d, segDist(p, ring[i]!, ring[(i + 1) % ring.length]!));
  return d;
}

function ringBox(ring: readonly Point[]) {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    maxX: Math.max(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}

function inside(p: Point, ring: readonly Point[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

const cutting = (m: GcodeMove) => m.type !== 'rapid' && m.to.z < 0 && m.from.z < 0;

/** Groups of consecutive XY cutting moves at one depth (a pass). */
function passes(moves: readonly GcodeMove[]): GcodeMove[][] {
  const out: GcodeMove[][] = [];
  let cur: GcodeMove[] = [];
  for (const m of moves) {
    const xy = m.from.x !== m.to.x || m.from.y !== m.to.y;
    if (cutting(m) && xy && m.from.z === m.to.z) cur.push(m);
    else if (cur.length > 0) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Signed area of a pass as a polygon of its samples (+ = CCW). */
function passArea(pass: readonly GcodeMove[]): number {
  const pts = pass.flatMap(sampleMove);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function exportText(project: Project, pv: never, post: PostId): string {
  const r = exportNc(project, pv, postConfig(post));
  expect(r.toolpathIssues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(r.postErrors).toEqual([]);
  expect(r.check?.violations).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.check && canDownload(r.check)).toBe(true);
  expect(r.files).toHaveLength(1);
  return r.files[0]!.content;
}

const directionAt0 = new Map<PostId, number>();

describe.each(['generic', 'mach3'] as const)(
  '%s: rotated part, read back from the G-code',
  (post) => {
    it.each(ANGLES)(
      'rot %s°: inside sheet, outside part at tool radius, closed, rapids above top',
      { timeout: 60_000 },
      (rot) => {
        const { project, pv } = setUp(rot, post);
        const text = exportText(project, pv, post);
        expect(text).not.toMatch(/e[+-]?\d|NaN|Infinity/);
        const read = readGcode(text, { strict: true });
        expect(read.errors).toEqual([]);
        expect(read.ok).toBe(true);

        const pl = project.layout.sheets[0]!.placements[0]!;
        const part = project.parts[0]!;
        const outline = placedOutline(part, pl);
        const ring = samplePoly(outline);
        const { width, height } = project.stock.sheet;

        const cuts = read.moves.filter(cutting);
        expect(cuts.length).toBeGreaterThan(0);
        const cutPts = cuts.flatMap(sampleMove);
        for (const p of cutPts) {
          // Tool fully on the sheet.
          expect(p.x - TOOL_R).toBeGreaterThanOrEqual(-TOL);
          expect(p.y - TOOL_R).toBeGreaterThanOrEqual(-TOL);
          expect(p.x + TOOL_R).toBeLessThanOrEqual(width + TOL);
          expect(p.y + TOOL_R).toBeLessThanOrEqual(height + TOL);
          // Compensation on the outside: the tool never bites into the part.
          expect(inside(p, ring)).toBe(false);
          expect(distTo(p, ring)).toBeGreaterThanOrEqual(TOOL_R - TOL);
        }
        // Coverage: every point of the rotated outline is touched by the tool edge.
        for (const q of ring) {
          let best = Infinity;
          for (const p of cutPts) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
          expect(best).toBeLessThanOrEqual(TOOL_R + 1.2);
        }
        // Arcs: radius consistent (reader) and every arc sample at tool radius from the outline,
        // except lead arcs, which stay farther away.
        const arcs = cuts.filter((m) => m.arc);
        expect(arcs.length).toBeGreaterThanOrEqual(4);
        let cornerArcs = 0;
        for (const m of arcs) {
          const d = sampleMove(m).map((p) => distTo(p, ring));
          if (d.every((v) => Math.abs(v - TOOL_R) <= 0.05)) cornerArcs++;
          else expect(Math.min(...d)).toBeGreaterThanOrEqual(TOOL_R - TOL);
        }
        expect(cornerArcs).toBeGreaterThanOrEqual(4);

        // Each depth pass closes on itself and turns the same way as at 0°.
        const ps = passes(read.moves);
        expect(ps.length).toBeGreaterThan(0);
        for (const pass of ps) {
          // Closed: some point of the pass is reached again at least 3 moves later (leads may hang
          // off either end of the loop).
          const pts = [pass[0]!.from, ...pass.map((m) => m.to)];
          const closes = pts.some((p, i) =>
            pts.slice(i + 3).some((q) => Math.hypot(p.x - q.x, p.y - q.y) < TOL),
          );
          expect(closes).toBe(true);
          const sign = Math.sign(passArea(pass));
          if (rot === ANGLES[0]) directionAt0.set(post, sign);
          expect(sign).toBe(directionAt0.get(post) ?? sign);
        }

        // No rapid through material: X/Y rapids only above the top (Z0 = material top).
        for (const m of read.moves) {
          if (m.type !== 'rapid') continue;
          if (m.from.x !== m.to.x || m.from.y !== m.to.y) {
            expect(m.from.z).toBeGreaterThan(0);
            expect(m.to.z).toBeGreaterThan(0);
          }
        }
      },
    );

    it('the part outline area is unchanged at any angle (no shape distortion)', () => {
      const a0 = signedArea(
        placedOutline(setUp(0, post).project.parts[0]!, { x: 0, y: 0, rot: 0 }),
      );
      for (const rot of ANGLES) {
        const { project } = setUp(rot, post);
        const a = signedArea(
          placedOutline(project.parts[0]!, project.layout.sheets[0]!.placements[0]!),
        );
        expect(Math.abs(a - a0)).toBeLessThan(1e-6);
      }
    });
  },
);

describe('grain-30° nested layout → G-code: no neighbour is cut (tester)', () => {
  it.each(['generic', 'mach3'] as const)('%s', { timeout: 120_000 }, (post) => {
    const g = golden(post, 'shelf-set');
    const base: Project = {
      ...g.project,
      stock: { ...g.project.stock, sheet: { ...g.project.stock.sheet, grain: 0 } },
      parts: g.project.parts.map((p) => ({ ...p, grain: { mode: 'fixed' as const, angle: 30 } })),
    };
    const nested = nestProject(base, { toolDiameter: 8 });
    const project: Project = { ...base, layout: nested.layout };
    // Grain rule in the layout.
    for (const s of project.layout.sheets)
      for (const pl of s.placements) expect([150, 330]).toContain(pl.rot);
    expect(nested.info.length).toBeGreaterThan(0);
    expect(nested.info.every((i) => i.code === 'GRAIN_ROTATED_BBOX' && i.extraArea > 0)).toBe(true);
    for (const p of project.parts)
      expect(allowedRotations(p, project.stock.sheet)).toEqual([150, 330]);

    const pv = { profile: g.context.profile, version: 1, verification: 'draft' as const } as never;
    const r = exportNc(project, pv, postConfig(post));
    expect(r.check?.violations).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.files.length).toBe(project.layout.sheets.length);
    r.files.forEach((f, si) => {
      const read = readGcode(f.content, { strict: true });
      expect(read.ok).toBe(true);
      const rings = project.layout.sheets[si]!.placements.map((pl) =>
        samplePoly(
          placedOutline(
            project.parts.find((p) => p.id === pl.partId)!,
            pl,
          ),
          12,
        ),
      );
      const pts = read.moves.filter(cutting).flatMap(sampleMove);
      const bad: { p: Point; d: number }[] = [];
      for (const p of pts)
        for (const ring of rings) {
          const b = ringBox(ring);
          if (
            p.x < b.minX - TOOL_R ||
            p.x > b.maxX + TOOL_R ||
            p.y < b.minY - TOOL_R ||
            p.y > b.maxY + TOOL_R
          )
            continue;
          if (inside(p, ring) || distTo(p, ring) < TOOL_R - TOL)
            bad.push({ p, d: distTo(p, ring) });
        }
      expect(bad.slice(0, 3)).toEqual([]);
      for (const m of read.moves)
        if (m.type === 'rapid' && (m.from.x !== m.to.x || m.from.y !== m.to.y))
          expect(Math.min(m.from.z, m.to.z)).toBeGreaterThan(0);
    });
  });
});
