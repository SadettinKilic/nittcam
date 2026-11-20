import { describe, expect, it } from 'vitest';
import { createSimPlayer } from './sim-player';

const steps = [
  { t0: 0, t1: 2, file: 0, line: 5 },
  { t0: 2, t1: 4, file: 0, line: 6 },
  { t0: 4, t1: 10, file: 1, line: 3 },
];

describe('sim player store (T157)', () => {
  it('seeks with clamping and follows the played line', () => {
    const p = createSimPlayer(steps, 10);
    let calls = 0;
    p.subscribe(() => calls++);
    p.setTime(3);
    expect(p.get()).toMatchObject({ time: 3, line: { file: 0, line: 6 } });
    p.setTime(99);
    expect(p.get().time).toBe(10);
    expect(p.get().line).toEqual({ file: 1, line: 3 });
    p.setTime(-5);
    expect(p.get().time).toBe(0);
    expect(calls).toBe(3);
  });

  it('every subscriber sees the same time (2D and 3D views)', () => {
    const p = createSimPlayer(steps, 10);
    const seen: number[] = [];
    p.subscribe(() => seen.push(p.get().time));
    p.subscribe(() => seen.push(p.get().time));
    p.setTime(5);
    expect(seen).toEqual([5, 5]);
  });

  it('keeps the line object while the line stays the same; no notify without change', () => {
    const p = createSimPlayer(steps, 10);
    p.setTime(5);
    const line = p.get().line;
    p.setTime(6);
    expect(p.get().line).toBe(line);
    let calls = 0;
    p.subscribe(() => calls++);
    p.setTime(6);
    p.setSpeed(5);
    expect(calls).toBe(0);
  });

  it('a new read keeps time, speed and play state, clamped', () => {
    const p = createSimPlayer(steps, 10);
    p.setTime(8);
    p.setSpeed(10);
    p.setPlaying(true);
    p.load(steps.slice(0, 2), 4);
    expect(p.get()).toMatchObject({ time: 4, speed: 10, playing: true, line: { line: 6 } });
    expect(p.duration()).toBe(4);
  });
});
