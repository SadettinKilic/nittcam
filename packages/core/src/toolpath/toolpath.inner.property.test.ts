/**
 * T134: inner contours (cut-outs) are cut, before the outer contour of the same part copy, with
 * the tool centre at the tool radius inside the opening, at every rotation. Written without the
 * builder's helpers: the placed opening comes from quarter-turn arithmetic on the rectangle.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import genericPost from '../../../machines/generic/v1/post.json';
import { EPS } from '../geometry/constants';
import { orientation } from '../geometry/polyline';
import { generateGcode } from '../post/generate';
import type { Project } from '../schema';
import { parseProject } from '../schema';
import { buildToolpath } from './build';
import { clone, machineOf, passLoop, projectOf, sampleMove } from './toolpath.testing';
import type { Operation } from './types';

const TOOL = 6;
const R = TOOL / 2;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface At {
  x: number;
  y: number;
  rot: number;
}

/** Part W×H with a rectangular opening, one copy at (x, y) turned by `rot`. */
function project(
  W: number,
  H: number,
  hole: Box,
  at: At,
  direction: 'climb' | 'conventional' = 'climb',
): Project {
  const base = clone(
    projectOf({
      parts: [{ id: 'p', w: W, h: H }],
      placements: [[{ partId: 'p', index: 0, ...at }]],
      direction,
    }),
  ) as unknown as { parts: { inners: unknown[] }[] };
  const part = base.parts[0];
  if (!part) throw new Error('fixture');
  part.inners = [
    [
      { x: hole.minX, y: hole.minY, bulge: 0 },
      { x: hole.minX, y: hole.maxY, bulge: 0 },
      { x: hole.maxX, y: hole.maxY, bulge: 0 },
      { x: hole.maxX, y: hole.minY, bulge: 0 },
    ],
  ];
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

/** The opening on the sheet: quarter-turn CCW about the part origin, box corner moved to (x, y). */
function placedHole(W: number, H: number, h: Box, at: At): Box {
  const map = (px: number, py: number) => {
    switch (at.rot) {
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
  const a = map(h.minX, h.minY);
  const b = map(h.maxX, h.maxY);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Every pass point lies on the opening shrunk by the tool radius. */
function passOffBy(op: Operation, hole: Box): string[] {
  const s = { minX: hole.minX + R, minY: hole.minY + R, maxX: hole.maxX - R, maxY: hole.maxY - R };
  const out: string[] = [];
  let prev = { x: NaN, y: NaN };
  for (const seg of op.segments) {
    for (const m of seg.moves) {
      if (seg.role === 'pass' && !Number.isNaN(prev.x)) {
        for (const q of sampleMove(prev, m)) {
          const inside =
            q.x >= s.minX - EPS &&
            q.x <= s.maxX + EPS &&
            q.y >= s.minY - EPS &&
            q.y <= s.maxY + EPS;
          const edge = Math.min(
            Math.abs(q.x - s.minX),
            Math.abs(q.x - s.maxX),
            Math.abs(q.y - s.minY),
            Math.abs(q.y - s.maxY),
          );
          if (!inside || edge > EPS) out.push(`${op.id}: (${q.x}, ${q.y}) off the path`);
        }
      }
      prev = { x: m.x, y: m.y };
    }
  }
  return out;
}

const machine = machineOf({ toolDiameter: TOOL, thickness: 18 });

describe('inner contours in the toolpath (T134)', () => {
  it('hand example: 40 × 30 opening in a 200 × 100 part; inner first, opposite travel, small slug tabbed (D-049)', () => {
    const hole = { minX: 30, minY: 20, maxX: 70, maxY: 50 };
    const at = { x: 100, y: 100, rot: 0 };
    const res = buildToolpath(project(200, 100, hole, at), machine);
    expect(res.errors).toEqual([]);
    const [inner, outer] = res.toolpath.operations;
    if (!inner || !outer) throw new Error('ops');
    expect(inner.kind).toBe('innerContour');
    expect(inner.id).toBe('p#0/inner0');
    expect(outer.kind).toBe('outerContour');
    // The 40 × 30 slug is small (D-049): tabs even with tabs off, at least 2.
    expect(inner.tabs.length).toBeGreaterThanOrEqual(2);
    expect(res.warnings.map((w) => w.code)).toContain('SMALL_SLUG_AUTO_TABS');
    expect(inner.passDepths).toEqual(outer.passDepths);
    expect(orientation(passLoop(outer, 0))).toBe('cw'); // climb outside the part
    expect(orientation(passLoop(inner, 0))).toBe('ccw'); // climb inside the opening
    expect(passOffBy(inner, placedHole(200, 100, hole, at))).toEqual([]);
    // T141: a lead-in inside the opening (waste side), no lead-out into the loose slug.
    expect(inner.segments.some((s) => s.role === 'leadIn')).toBe(true);
    expect(inner.segments.some((s) => s.role === 'leadOut')).toBe(false);
  });

  it('property: any rotation, size and opening; inner before outer; G-code generated', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 80, max: 600 }),
        fc.integer({ min: 80, max: 600 }),
        fc.double({ min: 0.05, max: 0.4, noNaN: true }),
        fc.double({ min: 0.05, max: 0.4, noNaN: true }),
        fc.double({ min: 0.1, max: 0.5, noNaN: true }),
        fc.double({ min: 0.1, max: 0.5, noNaN: true }),
        fc.constantFrom(0, 90, 180, 270),
        fc.constantFrom<'climb' | 'conventional'>('climb', 'conventional'),
        (W, H, fx, fy, fw, fh, rot, direction) => {
          const hole = {
            minX: Math.round(W * fx),
            minY: Math.round(H * fy),
            maxX: Math.round(W * fx) + Math.max(20, Math.round(W * fw)),
            maxY: Math.round(H * fy) + Math.max(20, Math.round(H * fh)),
          };
          fc.pre(hole.maxX < W - 5 && hole.maxY < H - 5);
          const at = { x: 50, y: 60, rot };
          const res = buildToolpath(project(W, H, hole, at, direction), machine);
          // D-049: a small slug (area < 50 000 mm² or a side < 100 mm) is held by at least 2 tabs
          // even with tabs off, or the toolpath is refused (never cut free); a large one follows
          // the project's tab setting (off here).
          const sw = hole.maxX - hole.minX;
          const sh = hole.maxY - hole.minY;
          const small = sw * sh < 50_000 || Math.min(sw, sh) < 100;
          if (res.errors.length > 0) {
            expect(small).toBe(true);
            expect(res.errors.map((e) => e.code)).toEqual(['SMALL_SLUG_UNSECURED']);
            expect(res.ok).toBe(false);
            return;
          }
          const ops = res.toolpath.operations;
          const iIn = ops.findIndex((o) => o.kind === 'innerContour');
          const iOut = ops.findIndex((o) => o.kind === 'outerContour');
          expect(iIn).toBeGreaterThanOrEqual(0);
          expect(iIn).toBeLessThan(iOut);
          const inner = ops[iIn] as Operation;
          const outer = ops[iOut] as Operation;
          if (small) expect(inner.tabs.length).toBeGreaterThanOrEqual(2);
          else expect(inner.tabs).toEqual([]);
          for (const t of inner.tabs) {
            expect(t.z).toBeGreaterThan(res.toolpath.targetDepth);
            expect(t.z).toBeLessThan(0);
          }
          expect(passOffBy(inner, placedHole(W, H, hole, at))).toEqual([]);
          expect(orientation(passLoop(inner, inner.passDepths.length - 1))).not.toBe(
            orientation(passLoop(outer, outer.passDepths.length - 1)),
          );
          const gc = generateGcode(
            res.toolpath,
            {
              // The generic post writes T.. M6: an automatic changer (as the golden profile).
              profile: {
                ...machine,
                toolChanger: { type: 'auto', capacity: 8, lengthCompensation: false },
              },
              version: 1,
              verification: 'draft',
            },
            genericPost as unknown,
            {
              projectName: 'T134',
              revision: 1,
              fileStem: 't134',
              stock: { material: 'mdf', thickness: 18, sheetWidth: 2440, sheetHeight: 1220 },
            },
          );
          expect(gc.errors).toEqual([]);
          expect(gc.ok).toBe(true);
        },
      ),
      { numRuns: 80 },
    );
  });

  it('an opening the tool cannot cut blocks the toolpath (no silent omission)', () => {
    const hole = { minX: 30, minY: 20, maxX: 34, maxY: 60 };
    const res = buildToolpath(project(200, 100, hole, { x: 100, y: 100, rot: 0 }), machine);
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('INNER_OFFSET_FAILED');
    expect(res.toolpath.operations.some((o) => o.kind === 'innerContour')).toBe(false);
  });
});
