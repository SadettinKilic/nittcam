import { afterEach, describe, expect, it } from 'vitest';
import { FpsWatch, slowHookFps } from './fps';

/** Feeds `n` frames at `fps` from `start` ms; returns the fire count and the next time. */
function feed(w: FpsWatch, fps: number, n: number, start = 0): { fired: number; t: number } {
  let fired = 0;
  let t = start;
  for (let i = 0; i < n; i++, t += 1000 / fps) if (w.frame(t)) fired++;
  return { fired, t };
}

describe('FpsWatch (T159)', () => {
  it('rate() reads the current run and is null without a run', () => {
    const w = new FpsWatch();
    expect(w.rate()).toBeNull();
    feed(w, 60, 30);
    expect(w.rate()).toBeCloseTo(60, 0);
    w.frame(10_000); // a long pause starts a new run
    expect(w.rate()).toBeNull();
  });

  it('reset() arms the watch again: a second slow run fires again (Basit mod → 2D)', () => {
    const w = new FpsWatch();
    const first = feed(w, 20, 80);
    expect(first.fired).toBe(1);
    expect(feed(w, 20, 80, first.t).fired).toBe(0);
    w.reset();
    expect(feed(w, 20, 80, first.t + 1000).fired).toBe(1);
  });

  it('a fast run (≥ 45 fps budget) never fires', () => {
    expect(feed(new FpsWatch(), 45, 1000).fired).toBe(0);
  });
});

describe('slowHookFps', () => {
  const g = globalThis as unknown as { window?: { __nittcam3dSlow?: unknown } };
  afterEach(() => {
    delete g.window;
  });
  it('is null unless the test hook holds a positive number', () => {
    expect(slowHookFps()).toBeNull(); // no window (server render)
    g.window = {};
    expect(slowHookFps()).toBeNull();
    g.window.__nittcam3dSlow = 'x';
    expect(slowHookFps()).toBeNull();
    g.window.__nittcam3dSlow = 10;
    expect(slowHookFps()).toBe(10);
  });
});
