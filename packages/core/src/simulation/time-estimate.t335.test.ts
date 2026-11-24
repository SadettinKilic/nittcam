/**
 * T335 (field rehearsal N4, D-127): the time estimate never counts a move faster than the machine
 * runs it. Each feed move is clamped at the machine's ceiling (`machineFeedLimits`: own maxFeed /
 * maxPlungeFeed, else the rapid rate and half of it; the plunge ceiling for a move down into the
 * material) and at the rapid rate; rapids at the rapid rate. Both estimates: the toolpath summary
 * and the simulation of the read program.
 */
import { describe, expect, it } from 'vitest';
import { checkFrame } from '../gcode-check';
import { golden, postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { machineFeedLimits } from '../machine';
import { goldenProfile } from '../post/golden.testing';
import { summarizeToolpath } from '../toolpath';
import { effectiveFeed } from '../toolpath/stats';
import { buildSimSheet } from './build';
import { simulateProject } from './simulate';

describe('effectiveFeed (T335)', () => {
  const cap = { feed: 5000, plunge: 1000 };
  it('clamps a level or rising move at the cutting ceiling, a plunge at the plunge ceiling', () => {
    expect(effectiveFeed(59_000, -5, -5, 20_000, cap)).toBe(5000);
    expect(effectiveFeed(59_000, 0, 5, 20_000, cap)).toBe(5000);
    expect(effectiveFeed(59_000, 0, -5, 20_000, cap)).toBe(1000);
    // going down above the material is not a plunge into it
    expect(effectiveFeed(59_000, 20, 2, 20_000, cap)).toBe(5000);
  });
  it('a feed under the ceiling stays; never above the rapid rate; no cap = rapid only', () => {
    expect(effectiveFeed(3000, -5, -5, 20_000, cap)).toBe(3000);
    expect(effectiveFeed(59_000, -5, -5, 4000, cap)).toBe(4000);
    expect(effectiveFeed(59_000, -5, -5, 20_000)).toBe(20_000);
  });
});

describe('time estimate at machine speed (T335)', () => {
  const g = golden('generic', 'mixed');
  const rapid = 10_000;

  it('toolpath summary: a ceiling above every feed changes nothing; a low one slows it', () => {
    const plain = summarizeToolpath(g.toolpath, rapid);
    const high = summarizeToolpath(g.toolpath, rapid, { feed: 60_000, plunge: 30_000 });
    expect(high.estimatedSeconds).toBeCloseTo(plain.estimatedSeconds, 9);
    const low = summarizeToolpath(g.toolpath, rapid, { feed: 500, plunge: 200 });
    expect(low.estimatedSeconds).toBeGreaterThan(plain.estimatedSeconds * 2);
    expect(low.cutLength).toBe(plain.cutLength);
  });

  it('toolpath summary: a programmed feed far above the machine (59 000) counts at the ceiling', () => {
    const fast = structuredClone(g.toolpath);
    for (const op of fast.operations)
      for (const seg of op.segments)
        for (const m of seg.moves) if (m.kind !== 'rapid') m.feed = 59_000;
    const atCap = structuredClone(g.toolpath);
    const cap = { feed: 8000, plunge: 2000 };
    for (const op of atCap.operations)
      for (const seg of op.segments)
        for (const m of seg.moves) if (m.kind !== 'rapid') m.feed = 1e9;
    const a = summarizeToolpath(fast, rapid, cap).estimatedSeconds;
    const b = summarizeToolpath(atCap, rapid, cap).estimatedSeconds;
    expect(a).toBeCloseTo(b, 9);
    // and far slower than the unclamped 59 000 estimate
    expect(a).toBeGreaterThan(summarizeToolpath(fast, 1e9).estimatedSeconds * 3);
  });

  it('the built toolpath uses the machine ceiling of its profile', () => {
    const profile = goldenProfile('generic');
    const limits = machineFeedLimits(profile);
    const expected = summarizeToolpath(g.toolpath, profile.rapidFeed ?? rapid, {
      feed: limits.feed.max,
      plunge: limits.plungeFeed.max,
    });
    const r = simulateProject(
      g.project,
      { profile, version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(r.ok).toBe(true);
    // same program, so the simulation (read file) and the model agree (plus the warm-up dwell)
    expect(Math.abs((r.summary?.seconds ?? 0) - 5 - expected.estimatedSeconds)).toBeLessThan(
      expected.estimatedSeconds * 0.05,
    );
  });

  it('simulation of the read program: a low ceiling slows every feed step, rapids unchanged', () => {
    const profile = goldenProfile('generic');
    const frame = checkFrame(profile, {
      thickness: g.project.stock.thickness,
      sheetWidth: 2800,
      sheetHeight: 2070,
    });
    const read = readGcode(g.text, { strict: true, dwellUnit: 's', extraMCodes: [] });
    const input = {
      sheet: 0,
      files: [{ name: g.file, content: g.text, read }],
      frame,
      rapidFeed: rapid,
      toolDiameters: { 2: 8 },
    };
    const plain = buildSimSheet(input);
    const high = buildSimSheet({ ...input, feedCap: { feed: 60_000, plunge: 30_000 } });
    const low = buildSimSheet({ ...input, feedCap: { feed: 500, plunge: 200 } });
    expect(high.totals.seconds).toBeCloseTo(plain.totals.seconds, 6);
    expect(low.totals.seconds).toBeGreaterThan(plain.totals.seconds * 2);
    const dur = (s: { t0: number; t1: number }) => s.t1 - s.t0;
    plain.steps.forEach((s, i) => {
      const l = low.steps[i];
      if (!l) throw new Error('step missing');
      if (s.kind === 'rapid') expect(dur(l)).toBeCloseTo(dur(s), 9);
      else expect(dur(l)).toBeGreaterThanOrEqual(dur(s) - 1e-9);
    });
  });
});
