/**
 * Playback model (T020, D-028): time mapping, seek to a line, step order. Synthetic steps so the
 * expected times are exact.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clampSimTime,
  lineAt,
  nextStepTime,
  playbackRate,
  positionAt,
  prevStepTime,
  simPlayheadAt,
  timeForLine,
} from './playback';
import type { SimStep } from './types';

function step(p: Partial<SimStep> & Pick<SimStep, 't0' | 't1' | 'line' | 'p0' | 'p1'>): SimStep {
  return {
    kind: 'cut',
    file: 0,
    length: 0,
    feed: 1000,
    zMin: 0,
    contour: 1,
    known: true,
    tool: 2,
    ...p,
  };
}

/** Points: (0,0,20) → (0,0,0) → (10,0,0) → (10,10,0) → (10,10,20). */
const points = [0, 0, 20, 0, 0, 0, 10, 0, 0, 10, 10, 0, 10, 10, 20];
/** Steps on lines 14, 16, 17, 19 with a 1 s dwell (line 15) before the second step. */
const steps: SimStep[] = [
  step({ kind: 'rapid', line: 14, p0: 0, p1: 1, t0: 0, t1: 2, length: 20 }),
  step({ line: 16, p0: 1, p1: 2, t0: 3, t1: 5, length: 10 }),
  step({ line: 17, p0: 2, p1: 3, t0: 5, t1: 9, length: 10 }),
  step({ kind: 'rapid', line: 19, p0: 3, p1: 4, t0: 9, t1: 10, length: 20 }),
];
const duration = 10;

describe('time mapping', () => {
  it('t = 0: nothing done, nothing active', () => {
    expect(simPlayheadAt(steps, 0)).toEqual({ done: 0, active: -1, fraction: 0 });
    expect(lineAt(steps, 0)).toBeNull();
  });

  it('inside a step: active with its fraction', () => {
    expect(simPlayheadAt(steps, 1)).toEqual({ done: 0, active: 0, fraction: 0.5 });
    expect(simPlayheadAt(steps, 7)).toEqual({ done: 2, active: 2, fraction: 0.5 });
    expect(lineAt(steps, 7)).toEqual({ file: 0, line: 17 });
  });

  it('at a step end the step is done; during a dwell nothing is active', () => {
    expect(simPlayheadAt(steps, 2)).toEqual({ done: 1, active: -1, fraction: 0 });
    expect(simPlayheadAt(steps, 2.5)).toEqual({ done: 1, active: -1, fraction: 0 });
    expect(lineAt(steps, 2.5)).toEqual({ file: 0, line: 14 });
  });

  it('at the end every step is done', () => {
    expect(simPlayheadAt(steps, duration).done).toBe(steps.length);
    expect(simPlayheadAt(steps, 1e9).done).toBe(steps.length);
  });

  it('position interpolates along the active step and rests at a step end', () => {
    expect(positionAt({ points, steps }, 0)).toEqual({ x: 0, y: 0, z: 20, step: -1 });
    expect(positionAt({ points, steps }, 1)).toMatchObject({ x: 0, y: 0, z: 10 });
    expect(positionAt({ points, steps }, 4)).toMatchObject({ x: 5, y: 0, z: 0, step: 1 });
    expect(positionAt({ points, steps }, 2.5)).toMatchObject({ x: 0, y: 0, z: 0, step: 0 });
    expect(positionAt({ points, steps }, duration)).toMatchObject({ x: 10, y: 10, z: 20 });
  });

  it('position on a multi-point (sampled arc) step goes by length', () => {
    const pts = [0, 0, 0, 10, 0, 0, 10, 30, 0];
    const s = [step({ line: 1, p0: 0, p1: 2, t0: 0, t1: 4, length: 40 })];
    expect(positionAt({ points: pts, steps: s }, 1)).toMatchObject({ x: 10, y: 0 });
    expect(positionAt({ points: pts, steps: s }, 2)).toMatchObject({ x: 10, y: 10 });
  });

  it('clamps times', () => {
    expect(clampSimTime(10, -1)).toBe(0);
    expect(clampSimTime(10, Number.NaN)).toBe(0);
    expect(clampSimTime(10, 11)).toBe(10);
    expect(clampSimTime(10, 4)).toBe(4);
  });

  it('playback rate: fixed speeds, "max" plays a sheet in about 10 s', () => {
    expect(playbackRate(5, 600)).toBe(5);
    expect(playbackRate('max', 600)).toBe(60);
    expect(playbackRate('max', 30)).toBe(20);
  });
});

describe('seek to a line', () => {
  it('a move line seeks to the end of its move', () => {
    expect(timeForLine(steps, 0, 16, duration)).toBe(5);
    expect(lineAt(steps, timeForLine(steps, 0, 16, duration))).toEqual({ file: 0, line: 16 });
  });

  it('a line without a move seeks to the start of the next move', () => {
    expect(timeForLine(steps, 0, 15, duration)).toBe(3);
    expect(timeForLine(steps, 0, 1, duration)).toBe(0);
  });

  it('a line after the last move seeks to the end', () => {
    expect(timeForLine(steps, 0, 25, duration)).toBe(duration);
  });

  it('respects the file order', () => {
    const two = [
      step({ line: 5, p0: 0, p1: 1, t0: 0, t1: 1 }),
      step({ file: 1, line: 3, p0: 1, p1: 2, t0: 1, t1: 2 }),
    ];
    expect(timeForLine(two, 0, 9, 2)).toBe(1);
    expect(timeForLine(two, 1, 3, 2)).toBe(2);
  });
});

describe('step order', () => {
  it('next/prev walk the step ends in order', () => {
    const seen: number[] = [];
    let t = 0;
    for (let i = 0; i < 10 && t < duration; i += 1) {
      t = nextStepTime(steps, t, duration);
      seen.push(t);
    }
    expect(seen).toEqual([2, 5, 9, 10]);
    const back: number[] = [];
    for (let i = 0; i < 10 && t > 0; i += 1) {
      t = prevStepTime(steps, t);
      back.push(t);
    }
    expect(back).toEqual([9, 5, 2, 0]);
  });

  it('from the middle of a step, next finishes it and prev goes to the previous end', () => {
    expect(nextStepTime(steps, 6, duration)).toBe(9);
    expect(prevStepTime(steps, 6)).toBe(5);
    expect(nextStepTime(steps, 2.5, duration)).toBe(5);
  });

  it('property: random timelines — next is strictly later, prev strictly earlier, done is monotone', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ dwell: fc.nat(3), span: fc.integer({ min: 0, max: 5 }) }), {
          minLength: 1,
          maxLength: 40,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (spec, u) => {
          let t = 0;
          const s = spec.map((x, i) => {
            const t0 = t + x.dwell;
            t = t0 + x.span;
            return step({ line: i + 1, p0: i, p1: i + 1, t0, t1: t });
          });
          const total = t;
          const at = total * u;
          const n = nextStepTime(s, at, total);
          const p = prevStepTime(s, at);
          if (at < total) expect(n).toBeGreaterThan(at);
          if (at > 0) expect(p).toBeLessThan(at);
          expect(simPlayheadAt(s, n).done).toBeGreaterThanOrEqual(simPlayheadAt(s, at).done);
          // Seeking to a move line shows that move completed.
          for (const st of s) {
            const ts = timeForLine(s, 0, st.line, total);
            expect(simPlayheadAt(s, ts).done).toBeGreaterThan(s.indexOf(st));
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
