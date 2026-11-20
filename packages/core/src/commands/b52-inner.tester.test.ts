/**
 * B52 tester (D-092): a cut-out moved or resized with `updateInnerContour` still exports a valid
 * NC file, and the read-back G-code cuts the opening at its new place (never at the old one, never
 * outside the part). Independent read-back with the G-code reader; geometry written out by hand.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode, type GcodeMove } from '../gcode-reader';
import { exportNc } from '../export';
import type { Point } from '../geometry/types';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { clone, projectOf } from '../toolpath/toolpath.testing';
import { applyCommand, CommandStack } from './index';

const v = (x: number, y: number, bulge = 0) => ({ x, y, bulge });
// Part 'a' 300 × 200 at sheet (20, 20); cut-out 100 × 80 at part (40, 40).
const AT = { x: 20, y: 20 };
const PART = { w: 300, h: 200 };

function project(inner = [v(40, 40), v(40, 120), v(140, 120), v(140, 40)]): Project {
  const base = clone(
    projectOf({
      parts: [{ id: 'a', w: PART.w, h: PART.h }],
      placements: [[{ partId: 'a', index: 0, x: AT.x, y: AT.y, rot: 0 }]],
    }),
  ) as unknown as { parts: Record<string, unknown>[] };
  (base.parts[0] as Record<string, unknown>)['inners'] = [inner];
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const profile = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

function samples(m: GcodeMove, n = 16): Point[] {
  const out: Point[] = [];
  if (m.arc) {
    const a0 = Math.atan2(m.from.y - m.arc.cy, m.from.x - m.arc.cx);
    const sweep = m.arc.direction === 'ccw' ? Math.abs(m.arc.sweep) : -Math.abs(m.arc.sweep);
    for (let k = 0; k <= n; k++) {
      const a = a0 + (sweep * k) / n;
      out.push({
        x: m.arc.cx + m.arc.radius * Math.cos(a),
        y: m.arc.cy + m.arc.radius * Math.sin(a),
      });
    }
  } else {
    for (let k = 0; k <= n; k++) {
      out.push({
        x: m.from.x + ((m.to.x - m.from.x) * k) / n,
        y: m.from.y + ((m.to.y - m.from.y) * k) / n,
      });
    }
  }
  return out;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const inside = (p: Point, b: Box, m = 0) =>
  p.x > b.x0 + m && p.x < b.x1 - m && p.y > b.y0 + m && p.y < b.y1 - m;
const cutting = (m: GcodeMove) => m.type !== 'rapid' && Math.min(m.from.z, m.to.z) < 0;

/** Export + read back; cutting XY points (sheet frame). */
function cutPoints(p: Project, post: 'generic' | 'mach3') {
  const res = exportNc(p, profile(post), postConfig(post));
  const read = readGcode(res.files[0]?.content ?? '');
  return { res, read, pts: read.moves.filter(cutting).flatMap((m) => samples(m)) };
}

describe.each(['generic', 'mach3'] as const)('B52 tester: moved cut-out read back (%s)', (post) => {
  it('the opening is cut at its new place, nothing at the old place, all inside the part', () => {
    const moved = applyCommand(project(), 'updateInnerContour', {
      id: 'a',
      index: 0,
      x: 170,
      y: 90,
    });
    if (!moved.ok) throw new Error(moved.error.message);
    const { res, read, pts } = cutPoints(moved.project, post);
    expect(res.ok).toBe(true);
    expect(res.check?.violations ?? []).toEqual([]);
    expect(read.errors).toEqual([]);
    // sheet frame: new opening 190..290 × 110..190, old one 60..160 × 60..140
    const fresh: Box = { x0: AT.x + 170, y0: AT.y + 90, x1: AT.x + 270, y1: AT.y + 170 };
    const old: Box = { x0: AT.x + 40, y0: AT.y + 40, x1: AT.x + 140, y1: AT.y + 120 };
    const part: Box = { x0: AT.x, y0: AT.y, x1: AT.x + PART.w, y1: AT.y + PART.h };
    expect(pts.filter((q) => inside(q, fresh, -0.01)).length).toBeGreaterThan(10);
    // old opening interior (1 mm in) is never cut: the cutter path of the outer contour stays out
    expect(pts.filter((q) => inside(q, old, 1))).toEqual([]);
    // cut-out passes stay inside the part (outer contour runs outside it, at tool radius + lead)
    const innerPts = pts.filter((q) => inside(q, part, 1));
    expect(innerPts.every((q) => inside(q, fresh, -0.01))).toBe(true);
  });

  it('a circle cut-out resized by width keeps its round shape in the G-code (arcs)', () => {
    const circle = project([v(100, 100, 1), v(160, 100, 1)]); // Ø60 at (130, 100)
    const r = applyCommand(circle, 'updateInnerContour', { id: 'a', index: 0, width: 90 });
    if (!r.ok) throw new Error(r.error.message);
    const vs = r.project.parts[0]?.inners[0] ?? [];
    expect(vs.every((q) => q.bulge === 1)).toBe(true);
    const { res, read } = cutPoints(r.project, post);
    expect(res.ok).toBe(true);
    expect(read.errors).toEqual([]);
    expect(read.moves.some((m) => cutting(m) && m.arc)).toBe(true);
  });
});

describe('B52 tester: updateInnerContour refuses what cannot be cut', () => {
  const p = project();
  const bad: [string, Record<string, unknown>][] = [
    ['past the right edge', { x: 250 }],
    ['negative x (left of the part)', { x: -5 }],
    ['touching the bottom edge', { y: 0 }],
    ['larger than the part', { width: 400 }],
    ['zero width', { width: 0 }],
    ['non-finite', { x: Number.POSITIVE_INFINITY }],
    ['no such index', { index: 3, x: 10 }],
  ];
  it.each(bad)('%s → error, project unchanged', (_what, extra) => {
    const r = applyCommand(p, 'updateInnerContour', { id: 'a', index: 0, ...extra });
    expect(r.ok).toBe(false);
  });

  it('a circle cannot be stretched to an oval', () => {
    const circle = project([v(100, 100, 1), v(160, 100, 1)]);
    const r = applyCommand(circle, 'updateInnerContour', {
      id: 'a',
      index: 0,
      width: 90,
      height: 40,
    });
    expect(r.ok).toBe(false);
  });

  it('any accepted move stays inside the part and exports clean; undo restores it (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 220 }),
        fc.integer({ min: -20, max: 140 }),
        (x, y) => {
          const stack = new CommandStack(p);
          const res = stack.execute(
            'updateInnerContour',
            { id: 'a', index: 0, x, y },
            {
              actor: 'user',
              at: '2026-11-21T00:00:00Z',
            },
          );
          const ok = x > 0 && y > 0 && x + 100 < PART.w && y + 80 < PART.h;
          if (!ok) return !res.ok;
          if (!res.ok) return false;
          const vs = stack.project.parts[0]?.inners[0] ?? [];
          if (!vs.every((q) => q.x > 0 && q.x < PART.w && q.y > 0 && q.y < PART.h)) return false;
          const out = exportNc(stack.project, profile('mach3'), postConfig('mach3'));
          if (!out.ok || readGcode(out.files[0]?.content ?? '').errors.length) return false;
          stack.undo();
          return JSON.stringify(stack.project) === JSON.stringify(p);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('B52 tester: a cut-out moved over a hole never reaches the machine', () => {
  it('either the move is refused or the export is blocked', () => {
    const base = clone(
      projectOf({
        parts: [{ id: 'a', w: PART.w, h: PART.h }],
        placements: [[{ partId: 'a', index: 0, x: AT.x, y: AT.y, rot: 0 }]],
      }),
    ) as unknown as { parts: Record<string, unknown>[] };
    const a = base.parts[0] as Record<string, unknown>;
    a['inners'] = [[v(40, 40), v(40, 120), v(140, 120), v(140, 40)]];
    a['holes'] = [{ type: 'through', id: 'h1', d: 20, cx: 220, cy: 80, tool: 1 }];
    const parsed = parseProject(base);
    if (!parsed.ok) throw new Error('fixture');
    const r = applyCommand(parsed.project, 'updateInnerContour', {
      id: 'a',
      index: 0,
      x: 170,
      y: 40,
    });
    if (!r.ok) return;
    for (const post of ['generic', 'mach3'] as const) {
      expect(exportNc(r.project, profile(post), postConfig(post)).ok).toBe(false);
    }
  });
});
