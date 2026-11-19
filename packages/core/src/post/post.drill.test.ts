import { describe, expect, it } from 'vitest';
import { checkGcode } from '../gcode-check/check';
import { expectedLayout } from '../gcode-check/layout';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import { buildToolpath } from '../toolpath';
import { goldenProfile, holeFixtureProject } from './golden.testing';
import { metaFor, run } from './post.testing';

// T139 / D-050: drill operations as G81 (one cycle per peck), never G83; read back and checked.

const DRILL = [{ id: 'h', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 }];

function setup(cycles: 'none' | 'G81' | 'G83', allowed = true) {
  const profile = goldenProfile('generic');
  profile.constraints.drillCycles = allowed;
  const project = holeFixtureProject(DRILL);
  const tp = buildToolpath(project, profile);
  if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
  const config = structuredClone(postConfig('generic'));
  config.drill.cycles = cycles;
  const res = run({ toolpath: tp.toolpath, profile, config, meta: metaFor(18) });
  const text = res.files[0]?.content ?? '';
  const context = {
    profile,
    verification: 'draft' as const,
    post: config,
    toolpath: tp.toolpath,
    stock: { thickness: 18, sheetWidth: 2800, sheetHeight: 2070 },
    sheet: 0,
    layout: expectedLayout(project, 0),
  };
  return { res, text, context, tp: tp.toolpath };
}

const cycleLines = (text: string) => text.split(/\r?\n/).filter((l) => /\bG8[0-9]\b/.test(l));

describe('drill cycles in the post (D-050)', () => {
  it('G81 on: one G99 G81 per peck with R = clearance, then G80; the checks pass', () => {
    const { res, text, context, tp } = setup('G81');
    expect(res.errors).toEqual([]);
    const pecks = tp.operations.filter((o) => o.kind === 'drill')[0]?.passDepths.length ?? 0;
    const lines = cycleLines(text);
    // Two copies: pecks × 2 cycle lines, one G80 after each hole.
    expect(lines.filter((l) => l.includes('G81'))).toHaveLength(2 * pecks);
    expect(lines.filter((l) => /\bG80\b/.test(l))).toHaveLength(2);
    expect(lines[0]).toMatch(/^G99 G81 X160\.000 Y160\.000 Z-4\.625 R2\.000 F1500$/);
    expect(text).not.toMatch(/\bG83\b/);
    const check = checkGcode(text, context);
    expect(check.violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('a post set to G83 still writes G81 only; drillCycles off in the profile = explicit moves', () => {
    expect(setup('G83').text).not.toMatch(/\bG83\b/);
    expect(cycleLines(setup('G83').text).some((l) => l.includes('G81'))).toBe(true);
    expect(cycleLines(setup('G81', false).text)).toEqual([]);
    expect(cycleLines(setup('none').text)).toEqual([]);
  });

  it('failing input: a G81 below the Z limit is caught by the check', () => {
    const { text, context } = setup('G81');
    const deeper = text.replace(/Z-18\.500 R2\.000/, 'Z-21.000 R2.000');
    expect(deeper).not.toBe(text);
    const check = checkGcode(deeper, context);
    expect(check.ok).toBe(false);
  });

  it('failing input: a G83 program is rejected by the reader', () => {
    const { text, context } = setup('G81');
    const g83 = text.replace('G99 G81', 'G99 G83 Q2.000');
    expect(checkGcode(g83, context).ok).toBe(false);
  });
});

describe('reader: G81 expansion', () => {
  const PRE = 'G21 G90 G17 G54\nG0 Z20\nM3 S18000\nG0 X10 Y10\nG0 Z5\n';

  it('G99: rapid to R, feed to Z, rapid back to R', () => {
    const r = readGcode(`${PRE}G99 G81 X10 Y10 Z-6 R2 F900\nG80\nG0 Z20\nM5\nM30\n`);
    expect(r.errors).toEqual([]);
    const tail = r.moves.slice(-4).map((m) => [m.type, m.to.z, m.feed]);
    expect(tail).toEqual([
      ['rapid', 2, null],
      ['feed', -6, 900],
      ['rapid', 2, null],
      ['rapid', 20, null],
    ]);
  });

  it('G98: back to the initial Z; XY rapid first when the cycle moves', () => {
    const r = readGcode(`${PRE}G98 G81 X20 Y10 Z-6 R2 F900\nG80\nG0 Z20\nM5\nM30\n`);
    expect(r.errors).toEqual([]);
    const cyc = r.moves.filter((m) => m.line === 6).map((m) => [m.type, m.to.x, m.to.z]);
    expect(cyc).toEqual([
      ['rapid', 20, 5],
      ['rapid', 20, 2],
      ['feed', 20, -6],
      ['rapid', 20, 5],
    ]);
  });

  it('refused: incremental mode, missing R, Z above R, G83', () => {
    for (const bad of [
      'G91 G81 X0 Y0 Z-6 R2 F900',
      'G81 X10 Y10 Z-6 F900',
      'G81 X10 Y10 Z3 R2 F900',
      'G83 X10 Y10 Z-6 R2 Q1 F900',
    ]) {
      expect(readGcode(`${PRE}${bad}\nM5\nM30\n`).ok, bad).toBe(false);
    }
  });
});
