import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildToolpath } from './build';
import { zigzagDescent } from './descent';
import type { PathSeg } from './path';
import type { Move } from './types';
import {
  backFaceFixtureProject,
  backFaceProfile,
  vGrooveProfile,
  vGrooveTrayProject,
} from '../post/golden.testing';

const line = (len: number): PathSeg[] => [{ p0: { x: 0, y: 0 }, p1: { x: len, y: 0 }, bulge: 0 }];

/** Steepest descent (degrees) of feed moves from `start` on, over XY travel (lines only). */
function steepest(moves: readonly Move[], start: { x: number; y: number; z: number }): number {
  let at = start;
  let worst = 0;
  for (const m of moves) {
    const xy = Math.hypot(m.x - at.x, m.y - at.y);
    const drop = at.z - m.z;
    if (drop > 1e-9) worst = Math.max(worst, (Math.atan2(drop, xy) * 180) / Math.PI);
    at = m;
  }
  return worst;
}

describe('zigzagDescent (T423)', () => {
  it('two legs when the room holds the angle; ends at the start at the new depth', () => {
    const m = zigzagDescent(line(100), 0, -1.6, 2, 400);
    expect(m).not.toBeNull();
    expect(m).toHaveLength(2);
    const last = m?.[1];
    expect(last?.x).toBeCloseTo(0, 9);
    expect(last?.z).toBe(-1.6);
    expect(m?.[0]?.x).toBeCloseTo(0.8 / Math.tan((2 * Math.PI) / 180), 6);
    expect(m?.every((x) => x.feed === 400)).toBe(true);
  });

  it('more, shorter legs over a short room; never steeper than the angle', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 60, noNaN: true }),
        fc.double({ min: 0.01, max: 5, noNaN: true }),
        fc.double({ min: 0.5, max: 5, noNaN: true }),
        (room, drop, angle) => {
          const m = zigzagDescent(line(room), -1, -1 - drop, angle, 300);
          if (!m) return false;
          expect(m.length % 2).toBe(0);
          expect(steepest(m, { x: 0, y: 0, z: -1 })).toBeLessThanOrEqual(angle + 1e-6);
          const last = m[m.length - 1] as Move;
          expect(last.x).toBeCloseTo(0, 6);
          expect(last.z).toBe(-1 - drop);
          return m.every((x) => x.x <= room + 1e-9 && x.x >= -1e-9);
        },
      ),
    );
  });

  it('nothing to descend: no moves; no room: null (the caller keeps a plunge the checker refuses)', () => {
    expect(zigzagDescent(line(10), -1, -1, 2, 400)).toEqual([]);
    expect(zigzagDescent([], 0, -1, 2, 400)).toBeNull();
  });
});

/** Every feed move of a toolpath that goes down below the top (Z 0): its descent angle. */
function descents(ops: readonly { segments: readonly { moves: readonly Move[] }[] }[]): number[] {
  const out: number[] = [];
  for (const op of ops) {
    let at: Move | null = null;
    for (const s of op.segments) {
      for (const m of s.moves) {
        if (at && m.kind !== 'rapid') {
          const top = Math.min(at.z, 0);
          const drop = top - m.z;
          if (drop > 1e-9) {
            const total = at.z - m.z;
            const xy =
              m.kind === 'arc'
                ? Infinity // helical arcs only appear in ramps along the contour (shallow)
                : (Math.hypot(m.x - at.x, m.y - at.y) * drop) / total;
            out.push((Math.atan2(drop, xy) * 180) / Math.PI);
          }
        }
        at = m;
      }
    }
  }
  return out;
}

describe('ACM toolpaths take no straight plunge (T423, spec §7.2 rule 12)', () => {
  it('the tray: V-groove entries ramp at 2° (traits), nothing steeper', () => {
    const tp = buildToolpath(vGrooveTrayProject(8), vGrooveProfile('mach3'));
    expect(tp.ok).toBe(true);
    if (!tp.ok) return;
    const d = descents(tp.toolpath.operations);
    expect(d.length).toBeGreaterThan(0);
    expect(Math.max(...d)).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('the back-face parts: every tab end comes down on a zig-zag, nothing steeper than 2°', () => {
    const profile = backFaceProfile('mach3');
    const tp = buildToolpath(backFaceFixtureProject(8), profile);
    expect(tp.ok).toBe(true);
    if (!tp.ok) return;
    expect(tp.toolpath.operations.some((o) => o.tabs.length > 0)).toBe(true);
    expect(Math.max(...descents(tp.toolpath.operations))).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('wood keeps its vertical plunges at the tab ends (unchanged)', () => {
    const p = backFaceFixtureProject(8);
    const wood = { ...p, stock: { ...p.stock, material: 'mdf', thickness: 18 } };
    const profile = backFaceProfile('mach3');
    const tp = buildToolpath(wood, profile);
    expect(tp.ok).toBe(true);
    if (!tp.ok) return;
    if (tp.toolpath.operations.some((o) => o.tabs.length > 0)) {
      expect(Math.max(...descents(tp.toolpath.operations))).toBe(90);
    }
  });
});
