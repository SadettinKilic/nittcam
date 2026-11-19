/**
 * T141: inner contours with holes. Cut order through `buildToolpath` on drawn parts that have
 * holes and openings (holes → inner → outer per part copy, every feature exactly once), and the
 * lead-in of an opening on the waste side: inside the opening, at least the tool radius from its
 * edge, no lead-out. The opening is checked with box arithmetic, not the builder's helpers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EPS } from '../geometry/constants';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { clone, machineOf, projectOf, sampleMove } from './toolpath.testing';
import type { Operation } from './types';

const TOOL = 6;
const R = TOOL / 2;
const machine = machineOf({ toolDiameter: TOOL, thickness: 18 });

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PartSpec {
  w: number;
  h: number;
  /** Opening in the part frame. */
  open: Box;
  rot: 0 | 90 | 180 | 270;
}

const sideOf = (s: PartSpec) => Math.max(s.w, s.h);

/** Parts in a row on one sheet, each with one rectangular opening and two through holes. */
function project(specs: PartSpec[], leadIn: 'arc' | 'line', mode: 'minWaste' | 'fastest'): Project {
  let x = 20;
  const placements = specs.map((s, i) => {
    const pl = { partId: `p${i}`, index: 0, x, y: 20, rot: s.rot };
    x += sideOf(s) + 30;
    return pl;
  });
  const base = clone(
    projectOf({
      parts: specs.map((s, i) => ({ id: `p${i}`, w: s.w, h: s.h })),
      placements: [placements],
      leadIn,
    }),
  ) as unknown as {
    parts: { inners: unknown[]; holes: unknown[] }[];
    nesting: { mode: string };
  };
  base.nesting.mode = mode;
  specs.forEach((s, i) => {
    const part = base.parts[i];
    if (!part) throw new Error('fixture');
    const o = s.open;
    part.inners = [
      [
        { x: o.minX, y: o.minY, bulge: 0 },
        { x: o.minX, y: o.maxY, bulge: 0 },
        { x: o.maxX, y: o.maxY, bulge: 0 },
        { x: o.maxX, y: o.minY, bulge: 0 },
      ],
    ];
    part.holes = [
      { id: 'a', type: 'through', d: 8, cx: s.w - 20, cy: 20, tool: 1 },
      { id: 'b', type: 'through', d: 20, cx: s.w - 30, cy: s.h - 30, tool: 1 },
    ];
  });
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

/** The opening on the sheet: quarter turn CCW about the part origin, box corner moved to (x, y). */
function placedOpening(s: PartSpec, at: { x: number; y: number }): Box {
  const { w: W, h: H } = s;
  const map = (px: number, py: number) => {
    switch (s.rot) {
      case 90:
        return { x: at.x + H - py, y: at.y + px };
      case 180:
        return { x: at.x + W - px, y: at.y + H - py };
      case 270:
        return { x: at.x + py, y: at.y + W - px };
      default:
        return { x: at.x + px, y: at.y + py };
    }
  };
  const a = map(s.open.minX, s.open.minY);
  const b = map(s.open.maxX, s.open.maxY);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Lead-in points outside the opening shrunk by the tool radius (the cutter would touch the part). */
function leadOutsideWaste(op: Operation, o: Box): string[] {
  const s = { minX: o.minX + R, minY: o.minY + R, maxX: o.maxX - R, maxY: o.maxY - R };
  const out: string[] = [];
  let prev = { x: NaN, y: NaN };
  for (const seg of op.segments) {
    for (const m of seg.moves) {
      if (seg.role === 'leadIn' && !Number.isNaN(prev.x)) {
        for (const q of sampleMove(prev, m)) {
          if (q.x < s.minX - EPS || q.x > s.maxX + EPS || q.y < s.minY - EPS || q.y > s.maxY + EPS)
            out.push(`${op.id}: lead point (${q.x}, ${q.y}) outside the waste`);
        }
      }
      prev = { x: m.x, y: m.y };
    }
  }
  return out;
}

const partSpec = fc
  .record({
    w: fc.integer({ min: 220, max: 480 }),
    h: fc.integer({ min: 160, max: 480 }),
    fw: fc.double({ min: 0.1, max: 1, noNaN: true }),
    fh: fc.double({ min: 0.1, max: 1, noNaN: true }),
    rot: fc.constantFrom<0 | 90 | 180 | 270>(0, 90, 180, 270),
  })
  .map(({ w, h, fw, fh, rot }): PartSpec => {
    // The opening sits in the left part; the holes are near the right edge (clear of it).
    const maxW = w - 40 - 60;
    const maxH = h - 40;
    const ow = Math.max(24, Math.round(maxW * fw));
    const oh = Math.max(24, Math.round(maxH * fh));
    return {
      w,
      h,
      rot,
      open: { minX: 20, minY: 20, maxX: 20 + ow, maxY: 20 + Math.min(oh, maxH) },
    };
  });

describe('inner contours with holes (T141)', () => {
  it('hand example: the opening gets an arc lead-in inside the opening, no lead-out', () => {
    const spec: PartSpec = {
      w: 300,
      h: 200,
      rot: 0,
      open: { minX: 20, minY: 20, maxX: 180, maxY: 180 },
    };
    const res = buildToolpath(project([spec], 'arc', 'minWaste'), machine);
    expect(res.errors).toEqual([]);
    const inner = res.toolpath.operations.find((o) => o.kind === 'innerContour');
    if (!inner) throw new Error('no inner');
    const roles = inner.segments.map((s) => s.role);
    expect(roles).toContain('leadIn');
    expect(roles).not.toContain('leadOut');
    expect(leadOutsideWaste(inner, placedOpening(spec, { x: 20, y: 20 }))).toEqual([]);
    // The approach plunges inside the opening, a full tool radius from its edge.
    const plunge = inner.segments[0]?.moves.find((m) => m.kind === 'plunge');
    if (!plunge) throw new Error('no plunge');
    const o = placedOpening(spec, { x: 20, y: 20 });
    const edge = Math.min(
      plunge.x - o.minX,
      o.maxX - plunge.x,
      plunge.y - o.minY,
      o.maxY - plunge.y,
    );
    expect(edge).toBeGreaterThan(R + EPS);
    // The retract happens on the path (last pass end), not out in a loose slug.
    expect(res.warnings.filter((w) => w.code === 'LEAD_REMOVED')).toEqual([]);
  });

  it('property: holes → inner → outer per copy, each feature once, leads in the waste', () => {
    fc.assert(
      fc.property(
        fc.array(partSpec, { minLength: 1, maxLength: 4 }),
        fc.constantFrom<'arc' | 'line'>('arc', 'line'),
        fc.constantFrom<'minWaste' | 'fastest'>('minWaste', 'fastest'),
        (specs, leadIn, mode) => {
          const res = buildToolpath(project(specs, leadIn, mode), machine);
          // A small slug that cannot hold 2 tabs is refused, never cut free (D-049).
          const blocking = res.errors.filter((e) => e.code !== 'SMALL_SLUG_UNSECURED');
          expect(blocking).toEqual([]);
          if (res.errors.length > 0) return;
          const ops = res.toolpath.operations;
          let x = 20;
          specs.forEach((s, i) => {
            const at = { x, y: 20 };
            x += sideOf(s) + 30;
            const idx = (pred: (o: Operation) => boolean) =>
              ops.flatMap((o, k) => (o.partId === `p${i}` && pred(o) ? [k] : []));
            const holes = idx((o) => o.holeId !== undefined);
            const inners = idx((o) => o.kind === 'innerContour');
            const outers = idx((o) => o.kind === 'outerContour');
            expect(holes).toHaveLength(2);
            expect(inners).toHaveLength(1);
            expect(outers).toHaveLength(1);
            expect(Math.max(...holes)).toBeLessThan(inners[0] as number);
            expect(inners[0] as number).toBeLessThan(outers[0] as number);
            const inner = ops[inners[0] as number] as Operation;
            expect(inner.segments.some((sg) => sg.role === 'leadOut')).toBe(false);
            expect(leadOutsideWaste(inner, placedOpening(s, at))).toEqual([]);
          });
          expect(ops).toHaveLength(specs.length * 4);
        },
      ),
      { numRuns: 60 },
    );
  });
});
