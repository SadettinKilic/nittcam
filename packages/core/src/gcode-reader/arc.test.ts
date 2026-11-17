/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
import { describe, expect, it } from 'vitest';
import { moveLength, sampleMove } from './arc';
import { toComparablePath } from './comparable';
import { readGcode } from './reader';

const PROG = 'G21 G90 G17 G54 F1000\nG0 X10 Y0 Z5\nG1 Z-1\nG3 X0 Y10 Z-2 I-10 J0\nM30\n';

describe('sampleMove / moveLength', () => {
  const r = readGcode(PROG);
  const [rapid, plunge, arc] = r.moves;

  it('a line gives its end point; length is 3D', () => {
    expect(sampleMove(plunge!)).toEqual([{ x: 10, y: 0, z: -1 }]);
    expect(moveLength(plunge!)).toBe(6);
    expect(moveLength(rapid!)).toBeCloseTo(Math.hypot(10, 5), 12);
  });

  it('an arc is split within the chord tolerance, Z linear, ending exactly at the end', () => {
    const tol = 0.01;
    const pts = sampleMove(arc!, tol);
    // Quarter arc of r 10: step ≤ 2·acos(1 − tol/r).
    expect(pts.length).toBe(Math.ceil(Math.PI / 2 / (2 * Math.acos(1 - tol / 10))));
    expect(pts.at(-1)).toEqual({ x: 0, y: 10, z: -2 });
    let prev = arc!.from;
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
      const mid = Math.hypot((p.x + prev.x) / 2, (p.y + prev.y) / 2);
      expect(10 - mid).toBeLessThanOrEqual(tol + 1e-12);
      expect(p.z).toBeLessThanOrEqual(prev.z);
      prev = p;
    }
    expect(moveLength(arc!)).toBeCloseTo(Math.hypot(5 * Math.PI, 1), 12);
  });
});

describe('toComparablePath', () => {
  it('maps to the neutral shape (same field names as the toolpath model)', () => {
    const cmp = toComparablePath(readGcode(PROG).moves);
    expect(cmp.start).toEqual({ x: 0, y: 0, z: 0 });
    expect(cmp.moves).toEqual([
      { kind: 'rapid', x: 10, y: 0, z: 5, feed: null, line: 2 },
      { kind: 'linear', x: 10, y: 0, z: -1, feed: 1000, line: 3 },
      { kind: 'arc', x: 0, y: 10, z: -2, cx: 0, cy: 0, direction: 'ccw', feed: 1000, line: 4 },
    ]);
    expect(toComparablePath([])).toEqual({ start: null, moves: [] });
  });
});
