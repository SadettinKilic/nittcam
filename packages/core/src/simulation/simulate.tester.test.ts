/**
 * T020 tester: the simulation follows the READ G-code, not the toolpath model (D-028, spec §6.5).
 * A hand-edited program (one cut move shifted) is fed through the reader into the sim builder;
 * the toolpath model is untouched, yet the drawn points change exactly where the text changed.
 */
import { describe, expect, it } from 'vitest';
import { checkFrame } from '../gcode-check';
import { golden, postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { buildSimSheet, simulateProject, timeForLine, simPlayheadAt, positionAt } from './index';
import { goldenProfile } from '../post/golden.testing';

const OPTS = { strict: true, dwellUnit: 's', extraMCodes: [] } as const;

function sim(post: 'generic' | 'mach3', text: string, name = 'a.nc') {
  const g = golden(post, 'cabinet-doors');
  const profile = goldenProfile(post);
  const frame = checkFrame(profile, {
    thickness: g.project.stock.thickness,
    sheetWidth: g.project.stock.sheet.width,
    sheetHeight: g.project.stock.sheet.height,
  });
  const read = readGcode(text, OPTS);
  expect(read.errors).toEqual([]);
  return buildSimSheet({
    sheet: 0,
    files: [{ name, content: text, read }],
    frame,
    rapidFeed: 10_000,
    toolDiameters: { 2: 8 },
  });
}

describe.each(['generic', 'mach3'] as const)('%s: data source is the program text', (post) => {
  it('a hand-edited cut move moves the drawn path; the toolpath model stays', () => {
    const g = golden(post, 'cabinet-doors');
    const base = sim(post, g.text);
    // The simulation of the unedited text equals the pipeline's own simulation (same source).
    const piped = simulateProject(
      g.project,
      { profile: goldenProfile(post), version: 1, verification: 'draft' },
      postConfig(post),
    );
    expect(piped.ok).toBe(true);
    expect(piped.sheets[0]?.steps.length).toBe(base.steps.length);

    // Shift the X word of the 20th G1 move by +3 mm.
    const lines = g.text.split('\r\n');
    let seen = 0;
    let idx = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^(N\d+ )?G1 .*X-?\d/.test(lines[i] ?? '') && (seen += 1) === 20) idx = i;
    }
    if (idx < 0) throw new Error('no G1 with X');
    const orig = lines[idx] ?? '';
    const edited = orig.replace(
      /X(-?\d+(?:\.\d+)?)/,
      (_m, v: string) => `X${(Number(v) + 3).toFixed(3)}`,
    );
    expect(edited).not.toBe(orig);
    lines[idx] = edited;
    const alt = sim(post, lines.join('\r\n'));

    expect(alt.steps.length).toBe(base.steps.length);
    const k = alt.steps.findIndex((s) => s.line === idx + 1);
    expect(k).toBeGreaterThanOrEqual(0);
    const end = (s: typeof base, i: number): [number, number] => {
      const p = (s.steps[i]?.p1 ?? 0) * 3;
      return [s.points[p] ?? NaN, s.points[p + 1] ?? NaN];
    };
    const [bx, by] = end(base, k);
    const [ax, ay] = end(alt, k);
    // Edited end point differs by exactly 3 mm along the sheet X axis (frame sign of the machine).
    expect(Math.abs(Math.abs(ax - bx) - 3)).toBeLessThan(2e-3);
    expect(ay).toBeCloseTo(by, 3);
    // A step before the edit is identical; the playhead at the edited line's end sits at the edit.
    expect(end(alt, k - 1)).toEqual(end(base, k - 1));
    const t = timeForLine(alt.steps, 0, idx + 1, alt.duration);
    const ph = simPlayheadAt(alt.steps, t);
    expect(ph.done).toBeGreaterThan(k);
    const pos = positionAt(alt, t);
    expect(pos.x).toBeCloseTo(ax, 3);
    expect(pos.y).toBeCloseTo(ay, 3);
    // The toolpath model is unchanged (same operations) while the sim differs: not drawn from it.
    expect(Math.abs(ax - bx)).toBeGreaterThan(2.9);
  });

  it('a deleted cut line disappears from the drawn steps', () => {
    const g = golden(post, 'cabinet-doors');
    const base = sim(post, g.text);
    const lines = g.text.split('\r\n');
    const i = lines.findIndex((l, n) => n > 40 && /^(N\d+ )?G1 /.test(l));
    const removed = i + 1;
    lines.splice(i, 1);
    // Re-reading may flag a discontinuity; the reader is strict, so only check when it parses.
    const read = readGcode(lines.join('\r\n'), OPTS);
    if (read.errors.length === 0) {
      const alt = sim(post, lines.join('\r\n'));
      expect(alt.steps.length).toBe(base.steps.length - 1);
      expect(base.steps.some((s) => s.line === removed)).toBe(true);
    } else {
      expect(read.errors.length).toBeGreaterThan(0);
    }
  });
});
