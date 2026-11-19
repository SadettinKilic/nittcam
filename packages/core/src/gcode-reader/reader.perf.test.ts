/// <reference types="node" />
/**
 * Performance of the G-code reader (T018): 100 000 lines in under 2 s, snapshots on.
 * The time is measured with `performance.now()` in the test only (core itself has no clock).
 */
import { describe, expect, it } from 'vitest';
import { readGcode } from './reader';

/** Timing budgets apply as written in CI; local runs on a loaded PC get PERF_BUDGET_SCALE (default 3, D-048). */
const BUDGET = process.env.CI ? 1 : Number(process.env.PERF_BUDGET_SCALE ?? 3);

function bigProgram(lines: number): string {
  const out = ['G21 G90 G91.1 G17 G54', 'M3 S18000', 'G4 P2', 'G0 X0 Y0 Z5', 'G1 Z-3 F1500'];
  let i = 0;
  while (out.length < lines - 2) {
    const x = (i % 1000) * 0.5;
    const y = Math.floor(i / 1000) * 0.5;
    out.push(`G1 X${(x + 10).toFixed(3)} Y${y.toFixed(3)} F6000`);
    out.push(`G2 X${(x + 20).toFixed(3)} Y${y.toFixed(3)} I5.000 J0.000 (arc ${i})`);
    out.push(`G3 X${(x + 10).toFixed(3)} Y${y.toFixed(3)} R5.000`);
    out.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)}`);
    i++;
  }
  out.length = lines - 2;
  out.push('M5', 'M30');
  return out.join('\r\n') + '\r\n';
}

describe('readGcode performance', () => {
  it('reads 100 000 lines in under 2 s', () => {
    const text = bigProgram(100_000);
    readGcode(bigProgram(2000)); // warm-up
    const t0 = performance.now();
    const r = readGcode(text);
    const ms = performance.now() - t0;
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(100_000);
    expect(r.moves.length).toBeGreaterThan(99_000);
    expect(ms).toBeLessThan(2000 * BUDGET);
  });
});
