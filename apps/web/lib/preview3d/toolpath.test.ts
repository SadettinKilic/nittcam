import type { SimSheet, SimStep } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { buildToolpath3d, depthColors, drawCounts, liftsAt, partLiftTimes } from './toolpath';

const TOP = [1, 1, 1] as const;
const BOTTOM = [0, 0, 0] as const;

type Sim = Pick<SimSheet, 'points' | 'steps' | 'zBottom'>;

function step(over: Partial<SimStep> & Pick<SimStep, 'p0' | 'p1' | 't0' | 't1'>): SimStep {
  return {
    kind: 'cut',
    file: 0,
    line: 1,
    length: 1,
    feed: 1000,
    zMin: -18,
    contour: 1,
    known: true,
    tool: 1,
    tab: false,
    ...over,
  };
}

/** Rapid to (10,10,5), plunge, square 10..110 around a 100×100 part, retract. */
function square(): Sim {
  const pts = [
    [0, 0, 5],
    [10, 10, 5],
    [10, 10, -18],
    [110, 10, -18],
    [110, 110, -18],
    [10, 110, -18],
    [10, 10, -18],
    [10, 10, 5],
  ];
  return {
    points: pts.flat(),
    zBottom: -18,
    steps: [
      step({ kind: 'rapid', p0: 0, p1: 1, t0: 0, t1: 1, zMin: 5, contour: 0, feed: null }),
      step({ p0: 1, p1: 2, t0: 1, t1: 2 }),
      step({ p0: 2, p1: 6, t0: 2, t1: 6 }),
      step({ kind: 'rapid', p0: 6, p1: 7, t0: 6, t1: 7, zMin: -18, contour: 0, feed: null }),
    ],
  };
}

describe('buildToolpath3d (T156)', () => {
  it('splits the read moves into cut and rapid segments with depth colours', () => {
    const b = buildToolpath3d(square(), TOP, BOTTOM);
    expect(b.rapid.length / 6).toBe(2);
    expect(b.cut.length / 6).toBe(5);
    expect(Array.from(b.cutEnd)).toEqual([0, 2, 10, 10]);
    expect(Array.from(b.rapidEnd)).toEqual([2, 2, 2, 4]);
    // Final-depth cuts take the bottom colour; Z stays in the sheet frame (top = 0).
    expect(Array.from(b.cutColor.slice(-3))).toEqual([0, 0, 0]);
    expect(b.cut[b.cut.length - 1]).toBe(-18);
  });

  it('skips the first segment of a step from an unknown position', () => {
    const sim = square();
    sim.steps[0] = { ...(sim.steps[0] as SimStep), known: false };
    expect(buildToolpath3d(sim, TOP, BOTTOM).rapid.length / 6).toBe(1);
  });

  it('builds a 50k-segment program within budget', () => {
    const n = 50_000;
    const points: number[] = [];
    const steps: SimStep[] = [];
    for (let i = 0; i <= n; i++) points.push(i % 2000, Math.floor(i / 2000) * 10, -18);
    for (let i = 0; i < n; i++) steps.push(step({ p0: i, p1: i + 1, t0: i, t1: i + 1 }));
    const t0 = performance.now();
    const b = buildToolpath3d({ points, steps, zBottom: -18 }, TOP, BOTTOM);
    const ms = performance.now() - t0;
    expect(b.cut.length / 6).toBe(n);
    expect(ms).toBeLessThan(250);
  });

  it('depth ramp runs from the top to the bottom colour', () => {
    const r = depthColors(TOP, BOTTOM, 3);
    expect(r).toEqual([
      [1, 1, 1],
      [0.5, 0.5, 0.5],
      [0, 0, 0],
    ]);
  });
});

describe('drawCounts (T157)', () => {
  const sim = square();
  const b = buildToolpath3d(sim, TOP, BOTTOM);
  it('draws everything without a time and nothing at 0', () => {
    expect(drawCounts(b, sim, null)).toEqual({ cut: 10, rapid: 4 });
    expect(drawCounts(b, sim, 0)).toEqual({ cut: 0, rapid: 0 });
  });
  it('reveals the step in progress by whole segments', () => {
    // Square step 2..6 has 4 segments; at t = 4 half of it is done.
    expect(drawCounts(b, sim, 4)).toEqual({ cut: 2 + 4, rapid: 2 });
    expect(drawCounts(b, sim, 7)).toEqual({ cut: 10, rapid: 4 });
  });
});

describe('partLiftTimes (T157)', () => {
  it('lifts a copy when its outer through-cut contour ends', () => {
    const times = partLiftTimes(square(), [
      { minX: 15, minY: 15, maxX: 105, maxY: 105 },
      { minX: 200, minY: 0, maxX: 300, maxY: 50 },
    ]);
    expect(times[0]).toBe(6);
    expect(times[1]).toBe(Infinity);
    expect(Array.from(liftsAt(times, 5.9, 3))).toEqual([0, 0]);
    expect(Array.from(liftsAt(times, 6, 3))).toEqual([3, 0]);
  });
  it('ignores contours that do not reach the final depth', () => {
    const sim = square();
    sim.steps[2] = { ...(sim.steps[2] as SimStep), zMin: -6 };
    sim.steps[1] = { ...(sim.steps[1] as SimStep), zMin: -6 };
    const times = partLiftTimes({ ...sim, zBottom: -18 }, [
      { minX: 15, minY: 15, maxX: 105, maxY: 105 },
    ]);
    expect(times[0]).toBe(Infinity);
  });
});
