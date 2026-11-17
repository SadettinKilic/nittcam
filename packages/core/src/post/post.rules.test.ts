/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * One failing-input test per §7.2 rule (T017): a deliberately bad config, profile or toolpath
 * must be refused (ok: false, no files), plus the matching positive check on a good program.
 */
import { describe, expect, it } from 'vitest';
import type { Move } from '../toolpath';
import { UNVERIFIED_HEADER } from './generate';
import {
  config,
  firstOp,
  profileFor,
  readBlocks,
  readMoves,
  run,
  sampleToolpath,
} from './post.testing';
import type { PostResult } from './types';

function refused(r: PostResult, code: string, rule?: number): void {
  expect(r.ok).toBe(false);
  expect(r.files).toEqual([]);
  const e = r.errors.find((x) => x.code === code);
  expect(e, JSON.stringify(r.errors)).toBeDefined();
  if (rule !== undefined) expect(e!.rule).toBe(rule);
}

function content(r: PostResult): string {
  expect(r.errors).toEqual([]);
  return r.files[0]!.content;
}

/** The pass segment's moves of the first operation. */
function passMoves(tp: ReturnType<typeof sampleToolpath>): Move[] {
  return firstOp(tp).segments.find((s) => s.role === 'pass')!.moves;
}

describe('rule 1: explicit modal state', () => {
  it.each(['G21', 'G90', 'G17', 'G54'])('refuses a config without %s', (word) => {
    const cfg = config('generic');
    cfg.modal.words = cfg.modal.words.filter((w) => w !== word);
    cfg.modal.words.push('G40');
    refused(run({ config: cfg }), 'INVALID_POST_CONFIG', 1);
  });

  it('refuses Mach3 without the declared arc distance word G91.1', () => {
    const cfg = config('mach3');
    cfg.modal.words = cfg.modal.words.filter((w) => w !== 'G91.1');
    refused(run({ config: cfg, profile: profileFor('mach3') }), 'INVALID_POST_CONFIG', 1);
  });

  it('refuses contradicting modal words (G20 inch, G91 incremental)', () => {
    for (const bad of ['G20', 'G91']) {
      const cfg = config('generic');
      cfg.modal.words.push(bad);
      refused(run({ config: cfg }), 'INVALID_POST_CONFIG', 1);
    }
  });

  it('writes units, absolute, plane, offset (and G91.1 for Mach3) before any motion', () => {
    const g = readBlocks(content(run()));
    expect(g[0]!.codes).toEqual(['G21', 'G90', 'G17', 'G54']);
    const m = readBlocks(content(run({ config: config('mach3'), profile: profileFor('mach3') })));
    expect(m[0]!.codes).toEqual(['G21', 'G90', 'G91.1', 'G17', 'G40', 'G49', 'G54']);
  });
});

describe('rule 2: first move to safe Z, XY rapids only at safe Z', () => {
  it('refuses an XY rapid below safe Z', () => {
    const tp = sampleToolpath();
    const approach = firstOp(tp).segments[0]!.moves;
    approach[0] = { kind: 'rapid', x: approach[0]!.x, y: approach[0]!.y, z: 5 };
    refused(run({ toolpath: tp }), 'RAPID_BELOW_SAFE_Z', 2);
  });

  it('refuses an XY rapid from inside the material', () => {
    const tp = sampleToolpath();
    const pass = passMoves(tp);
    pass.push({ kind: 'rapid', x: 0, y: 0, z: 20 });
    refused(run({ toolpath: tp }), 'RAPID_BELOW_SAFE_Z', 2);
  });

  it('refuses a toolpath whose safe Z is below the profile safe Z', () => {
    const tp = sampleToolpath();
    tp.safeZ = 5;
    refused(run({ toolpath: tp }), 'SAFE_Z_INVALID', 2);
  });

  it('the first motion block is G0 Z<safe>, and every XY rapid is at safe Z', () => {
    const moves = readMoves(content(run()));
    expect(moves[0]!.kind).toBe('rapid');
    expect(moves[0]!.to.z).toBe(20);
    expect(Number.isNaN(moves[0]!.to.x)).toBe(true);
    for (const m of moves) {
      if (m.kind !== 'rapid') continue;
      if (!Object.is(m.to.x, m.from.x) || !Object.is(m.to.y, m.from.y)) {
        expect(m.from.z).toBe(20);
        expect(m.to.z).toBe(20);
      }
    }
  });
});

describe('rule 3: no rapid into material, plunge at plunge feed', () => {
  it('refuses a rapid down into the material', () => {
    const tp = sampleToolpath();
    const approach = firstOp(tp).segments[0]!.moves;
    const last = approach[approach.length - 1]!;
    approach.push({ kind: 'rapid', x: last.x, y: last.y, z: -1 });
    refused(run({ toolpath: tp }), 'RAPID_INTO_MATERIAL', 3);
  });

  it('refuses a plunge at the cutting feed', () => {
    const tp = sampleToolpath();
    const op = firstOp(tp);
    const approach = op.segments[0]!.moves;
    const i = approach.findIndex((m) => m.kind === 'plunge');
    const p = approach[i]!;
    approach[i] = { kind: 'plunge', x: p.x, y: p.y, z: p.z, feed: op.feed };
    refused(run({ toolpath: tp }), 'PLUNGE_TOO_FAST', 3);
  });

  it('every descending feed move is at most the plunge feed', () => {
    for (const m of readMoves(content(run()))) {
      if (m.kind !== 'rapid' && m.to.z < m.from.z) expect(m.feed).toBeLessThanOrEqual(1500);
      if (m.kind === 'rapid') expect(m.to.z).toBeGreaterThan(0);
    }
  });
});

describe('rule 4: spindle on and warm-up before cutting', () => {
  it('refuses a spindle speed outside the spindle range', () => {
    const tp = sampleToolpath();
    firstOp(tp).rpm = 500;
    refused(run({ toolpath: tp }), 'SPINDLE_INVALID', 4);
  });

  it('refuses a non-finite spindle speed', () => {
    const tp = sampleToolpath();
    firstOp(tp).rpm = Number.NaN;
    refused(run({ toolpath: tp }), 'SPINDLE_INVALID', 4);
  });

  it('M3 S.. and G4 P<warm-up> come before the first feed move', () => {
    const blocks = readBlocks(content(run()));
    const m3 = blocks.findIndex((b) => b.codes.includes('M3'));
    const dwell = blocks.findIndex((b) => b.codes.includes('G4'));
    const firstFeed = blocks.findIndex((b) => b.codes.includes('G1'));
    expect(blocks[m3]!.line).toBe('M3 S18000');
    expect(blocks[dwell]!.line).toBe('G4 P5.0');
    expect(m3).toBeLessThan(dwell);
    expect(dwell).toBeLessThan(firstFeed);
  });

  it('dwell syntax follows the config: ms and X word', () => {
    const cfg = config('generic');
    cfg.dwell = { word: 'P', unit: 'ms', decimals: 0 };
    expect(content(run({ config: cfg }))).toContain('\r\nG4 P5000\r\n');
    cfg.dwell = { word: 'X', unit: 's', decimals: 2 };
    expect(content(run({ config: cfg }))).toContain('\r\nG4 X5.00\r\n');
  });

  it('a 0 s warm-up writes no dwell and warns', () => {
    const p = profileFor();
    p.spindle.warmupSeconds = 0;
    const r = run({ profile: p });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('NO_WARMUP');
    expect(r.files[0]!.content).not.toContain('G4');
  });
});

describe('rule 5: explicit feed on the first cutting move', () => {
  it('refuses a feed move without a valid feed', () => {
    for (const feed of [0, -5, Number.NaN]) {
      const tp = sampleToolpath();
      const pass = passMoves(tp);
      const i = pass.findIndex((m) => m.kind === 'linear');
      const m = pass[i]!;
      pass[i] = { kind: 'linear', x: m.x, y: m.y, z: m.z, feed };
      refused(run({ toolpath: tp }), 'FEED_INVALID', 5);
    }
  });

  it('refuses an operation with an invalid feed', () => {
    const tp = sampleToolpath();
    firstOp(tp).feed = Number.POSITIVE_INFINITY;
    refused(run({ toolpath: tp }), 'FEED_INVALID', 5);
  });

  it('F is written on the first cutting move after every rapid and every plunge', () => {
    const moves = readMoves(content(run()));
    for (let k = 1; k < moves.length; k++) {
      const prev = moves[k - 1]!;
      const m = moves[k]!;
      if (m.kind === 'rapid') continue;
      const prevIsPlunge = prev.kind === 'linear' && prev.to.z < prev.from.z;
      if (prev.kind === 'rapid' || prevIsPlunge)
        expect(m.feedWritten, m.index.toString()).toBe(true);
    }
  });
});

describe('rule 6: every coordinate inside the envelope', () => {
  it('refuses a move beyond the X travel', () => {
    const tp = sampleToolpath();
    const pass = passMoves(tp);
    const i = pass.findIndex((m) => m.kind === 'linear');
    const m = pass[i]!;
    pass[i] = { ...m, x: 2600 } as Move;
    refused(run({ toolpath: tp }), 'OUT_OF_ENVELOPE', 6);
  });

  it('refuses a sheet placed so far on the table that parts leave the travel', () => {
    const p = profileFor();
    p.origin.sheetOffset = { x: 0, y: 1000 };
    refused(run({ profile: p }), 'OUT_OF_ENVELOPE', 6);
  });

  it('refuses a safe Z above the Z travel (Z zero = table)', () => {
    const p = profileFor();
    p.zZero.reference = 'table';
    p.workEnvelope.z = 30;
    p.safeZ = 20;
    // 20 + 18 mm sheet = 38 above the table > 30 travel.
    refused(run({ profile: p, toolpath: sampleToolpath(p) }), 'OUT_OF_ENVELOPE', 6);
  });

  it('refuses a cut deeper than the spoilboard allowance', () => {
    const tp = sampleToolpath();
    const pass = passMoves(tp);
    const i = pass.findIndex((m) => m.kind === 'linear');
    pass[i] = { ...pass[i]!, z: -19.5 } as Move;
    expect(run({ toolpath: tp }).ok).toBe(false);
  });
});

describe('rule 7: safe Z, spindle off, vacuum off, end code at the end', () => {
  it('refuses a config without M30/M2', () => {
    const cfg = config('generic');
    cfg.program.end = ['M5'];
    refused(run({ config: cfg }), 'INVALID_POST_CONFIG', 7);
  });

  it('refuses a vacuum on code without an off code', () => {
    const p = profileFor();
    p.holdDown.vacuumOff = '';
    refused(run({ profile: p }), 'VACUUM_OFF_MISSING', 7);
  });

  it('ends with G0 Z<safe>, M5, vacuum off, M30', () => {
    const lines = readBlocks(content(run())).map((b) => b.line);
    expect(lines.slice(-4)).toEqual(['G0 Z20.000', 'M5', 'M9', 'M30']);
  });

  it('without vacuum codes ends with G0 Z, M5, M30', () => {
    const p = profileFor();
    p.holdDown = { type: 'clamp', vacuumOn: '', vacuumOff: '' };
    const lines = readBlocks(content(run({ profile: p }))).map((b) => b.line);
    expect(lines.slice(-3)).toEqual(['G0 Z20.000', 'M5', 'M30']);
  });
});

describe('rule 8: fixed decimals, no exponent/NaN/Infinity/-0/empty', () => {
  it('refuses a NaN coordinate', () => {
    const tp = sampleToolpath();
    const pass = passMoves(tp);
    pass[1] = { ...pass[1]!, x: Number.NaN } as Move;
    refused(run({ toolpath: tp }), 'NUMBER_INVALID', 8);
  });

  it('refuses an Infinity coordinate', () => {
    const tp = sampleToolpath();
    const pass = passMoves(tp);
    pass[1] = { ...pass[1]!, y: Number.POSITIVE_INFINITY } as Move;
    refused(run({ toolpath: tp }), 'NUMBER_INVALID', 8);
  });

  it('refuses an inconsistent arc', () => {
    const tp = sampleToolpath();
    const pass = passMoves(tp);
    const i = pass.findIndex((m) => m.kind === 'arc');
    const a = pass[i]!;
    if (a.kind !== 'arc') throw new Error('no arc');
    pass[i] = { ...a, cx: a.cx + 3 };
    refused(run({ toolpath: tp }), 'ARC_INVALID', 8);
  });

  it('every number in the program is fixed-decimal', () => {
    const r = run();
    for (const b of readBlocks(content(r))) {
      for (const w of b.line.split(' ')) {
        expect(w).toMatch(/^[A-Z](-?\d+(\.\d+)?)$/);
        expect(w).not.toMatch(/^[A-Z]-0(\.0+)?$/);
        if (/^[XYZIJ]/.test(w)) expect(w).toMatch(/\.\d{3}$/);
        if (w.startsWith('F')) expect(w).toMatch(/^F\d+$/);
      }
    }
  });
});

describe('rule 9: reader check hook blocks the result', () => {
  it('a failing check refuses all files', () => {
    const r = run({
      options: {
        check: () => [
          { code: 'CHECK_FAILED', severity: 'error', message: 'reader: rapid in material' },
        ],
      },
    });
    refused(r, 'CHECK_FAILED', 9);
  });

  it('the hook sees the files; warnings only do not refuse', () => {
    let seen = 0;
    const r = run({
      options: {
        check: (files) => {
          seen = files.length;
          return [{ code: 'CHECK_FAILED', severity: 'warning', message: 'note' }];
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(seen).toBe(1);
  });
});

describe('rule 10: unverified profile header', () => {
  const header = (r: PostResult) => r.files[0]!.content.split('\r\n')[0];

  it.each(['draft', 'air_cut_approved', 'test_cut_approved', 'reverify_needed'] as const)(
    'state %s gets the ASCII header first',
    (state) => {
      expect(header(run({ verification: state }))).toBe('(DOGRULANMADI, once air cut)');
    },
  );

  it('a verified profile still gets it while the post is unverified or the profile an example', () => {
    expect(header(run({ verification: 'verified' }))).toBe('(DOGRULANMADI, once air cut)');
    const cfg = config('generic');
    cfg.status = 'verified';
    expect(header(run({ verification: 'verified', config: cfg }))).toBe(
      '(DOGRULANMADI, once air cut)',
    );
  });

  it('verified profile + verified post + not an example: no warning header', () => {
    const cfg = config('generic');
    cfg.status = 'verified';
    const p = profileFor();
    p.example = false;
    const r = run({ verification: 'verified', config: cfg, profile: p });
    expect(r.files[0]!.content).not.toContain('DOGRULANMADI');
  });

  it('keeps the Turkish text when the config is not ASCII-only', () => {
    const cfg = config('generic');
    cfg.comments.asciiOnly = false;
    expect(header(run({ config: cfg }))).toBe(`(${UNVERIFIED_HEADER})`);
    expect(UNVERIFIED_HEADER).toBe('DOĞRULANMADI, önce air cut');
  });
});

describe('end sequence retracts once', () => {
  it('a single G0 Z<safe> before M5 (no duplicate after the toolpath retract)', () => {
    const lines = readBlocks(content(run())).map((b) => b.line);
    expect(lines.slice(-4)).toEqual(['G0 Z20.000', 'M5', 'M9', 'M30']);
    expect(lines.filter((l) => l === 'G0 Z20.000').length).toBeGreaterThan(1);
    expect(lines.at(-5)).not.toBe('G0 Z20.000');
  });

  it('still writes the end retract when the last motion was not a Z-only safe rapid', () => {
    const tp = sampleToolpath();
    const last = tp.operations.at(-1)!;
    last.segments = last.segments.filter((s) => s.role !== 'retract');
    // Lead-out ends in the material: the generator itself must retract.
    const lines = readBlocks(content(run({ toolpath: tp }))).map((b) => b.line);
    expect(lines.slice(-4)).toEqual(['G0 Z20.000', 'M5', 'M9', 'M30']);
    expect(lines.at(-5)).toMatch(/^G[123] /);
  });
});
