/**
 * T336 (B62 audit, D-128): a vacuum machine whose program writes no vacuum code (post vacuum off,
 * or no on-code in the profile) is not an error, but never silent: the NC header carries an ASCII
 * note. With a code written nothing changes. And the production check always gets the post, so
 * the checker never runs its lenient "no post given" modes.
 */
import { describe, expect, it } from 'vitest';
import { checkGcode, type GcodeCheckContext } from '../gcode-check';
import { assertPostGiven } from '../export/export';
import type { MachineProfile } from '../machine';
import type { PostConfig } from './config';
import { VACUUM_BY_HAND_HEADER, vacuumByHand } from './generate';
import { config, metaFor, profileFor, run, sampleToolpath, SHEET } from './post.testing';

const NOTE = `(${VACUUM_BY_HAND_HEADER})`;

function program(edit: (p: MachineProfile, c: PostConfig) => void) {
  const profile = profileFor('mach3');
  const cfg = config('mach3');
  edit(profile, cfg);
  const toolpath = sampleToolpath(profile);
  const r = run({ toolpath, profile, config: cfg });
  expect(r.errors).toEqual([]);
  const text = r.files[0]?.content ?? '';
  const ctx: GcodeCheckContext = {
    profile,
    verification: 'draft',
    post: cfg,
    toolpath,
    stock: {
      thickness: metaFor().stock.thickness,
      sheetWidth: SHEET.width,
      sheetHeight: SHEET.height,
    },
    sheet: 0,
  };
  const errors = checkGcode(text, ctx).violations.filter((v) => v.severity === 'error');
  return { text, errors };
}

describe('vacuumByHand (T336)', () => {
  const on = { vacuum: { enabled: true } };
  const off = { vacuum: { enabled: false } };
  it('only a vacuum machine without a written code', () => {
    expect(vacuumByHand({ holdDown: { type: 'vacuum', vacuumOn: 'M7' } }, on)).toBe(false);
    expect(vacuumByHand({ holdDown: { type: 'vacuum', vacuumOn: 'M7' } }, off)).toBe(true);
    expect(vacuumByHand({ holdDown: { type: 'vacuum', vacuumOn: '' } }, on)).toBe(true);
    expect(vacuumByHand({ holdDown: { type: 'clamp', vacuumOn: '' } }, off)).toBe(false);
    expect(vacuumByHand({ holdDown: { type: 'tSlot', vacuumOn: '' } }, on)).toBe(false);
  });
});

describe('NC header note when the vacuum is switched by hand (T336)', () => {
  it('vacuum code written: no note, the program has M7 / M9', () => {
    const { text, errors } = program(() => undefined);
    expect(text).not.toContain('VAKUM');
    expect(text).toMatch(/^M7\r?$/m);
    expect(errors).toEqual([]);
  });

  it('post vacuum off: the note, no vacuum code, the checker accepts it', () => {
    const { text, errors } = program((_p, c) => {
      c.vacuum.enabled = false;
    });
    expect(text).toContain(NOTE);
    expect(text).not.toMatch(/^M7\r?$/m);
    expect(errors).toEqual([]);
    // ASCII only, in the header (before the first code line)
    expect(text).toMatch(/^[\x20-\x7e\r\n]*$/);
    const lines = text.split(/\r?\n/);
    expect(lines.indexOf(NOTE)).toBeLessThan(lines.findIndex((l) => /^G21\b/.test(l)));
  });

  it('profile without vacuum codes: the note', () => {
    const { text } = program((p) => {
      p.holdDown.vacuumOn = '';
      p.holdDown.vacuumOff = '';
    });
    expect(text).toContain(NOTE);
  });

  it('clamps: no note', () => {
    const { text } = program((p) => {
      p.holdDown = { type: 'clamp', vacuumOn: '', vacuumOff: '' };
    });
    expect(text).not.toContain('VAKUM');
  });
});

describe('the production check always has the post (T336)', () => {
  it('assertPostGiven throws without a post and passes with one', () => {
    expect(() => assertPostGiven({})).toThrow(/post config/);
    expect(() => assertPostGiven({ post: undefined })).toThrow();
    expect(() => assertPostGiven({ post: config('mach3') })).not.toThrow();
  });
});
