/**
 * T311 tester: spellings of the optional stop that must not slip past the manual tool change
 * check (M01, lower case, a comment on the line, another word on the line, a line number, a space
 * after M), M00 still accepted, a comment saying M1 is not a stop, and auto mode unchanged.
 */
import { describe, expect, it } from 'vitest';
import { config, metaFor, profileFor, run, sampleToolpath, SHEET } from '../post/post.testing';
import { checkGcode, type GcodeCheckContext } from '.';

function program(mode: 'manual' | 'auto') {
  const profile = profileFor('mach3');
  profile.tools.push({ number: 3, type: 'flatEndMill', diameter: 6, fluteLength: 25, flutes: 2 });
  if (mode === 'auto')
    profile.toolChanger = { type: 'auto', capacity: 8, lengthCompensation: false };
  const toolpath = sampleToolpath(profile);
  const second = toolpath.operations[1];
  if (!second) throw new Error('sample toolpath needs two operations');
  second.tool = 3;
  second.toolDiameter = 6;
  const cfg = config('mach3');
  if (mode === 'auto') cfg.toolChange.mode = 'auto';
  const r = run({ toolpath, profile, config: cfg });
  expect(r.errors).toEqual([]);
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
  return { text: r.files[0]?.content ?? '', ctx };
}

const codes = (text: string, ctx: GcodeCheckContext) =>
  checkGcode(text, ctx)
    .violations.filter((v) => v.severity === 'error')
    .map((v) => v.code);

/** Replaces the last `M0` line (the real change) with `line`. */
function lastStop(text: string, line: string): string {
  const ls = text.split('\r\n');
  const k = ls.lastIndexOf('M0');
  if (k < 0) throw new Error('no M0');
  ls[k] = line;
  return ls.join('\r\n');
}

describe('T311 tester: optional stop spellings', () => {
  const { text, ctx } = program('manual');

  it('baseline clean, M00 still a valid stop', () => {
    expect(codes(text, ctx)).toEqual([]);
    expect(codes(lastStop(text, 'M00'), ctx)).toEqual([]);
  });

  it.each(['M1', 'M01', 'm1', 'm01', 'M1 (TAKIM)', 'N9000 M1', 'M 1', 'M5 M1'])(
    '%s at the tool change is refused',
    (line) => {
      expect(codes(lastStop(text, line), ctx)).toContain('TOOL_CHANGE_OPTIONAL_STOP');
    },
  );

  it('M1 and M0 on one line: the reader refuses the line', () => {
    expect(codes(lastStop(text, 'M1 M0'), ctx)).toContain('MODAL_GROUP_CONFLICT');
  });

  it('M1 at the first-tool check is refused too', () => {
    const ls = text.split('\r\n');
    ls[ls.indexOf('M0')] = 'M01';
    expect(codes(ls.join('\r\n'), ctx)).toContain('TOOL_CHANGE_OPTIONAL_STOP');
  });

  it('"(M1)" in a comment is not a stop (the missing pause is still an error)', () => {
    const c = codes(lastStop(text, '(M1)'), ctx);
    expect(c).not.toContain('TOOL_CHANGE_OPTIONAL_STOP');
    expect(c.length).toBeGreaterThan(0);
  });

  it('an extra M1 anywhere in a manual program is refused', () => {
    const ls = text.split('\r\n');
    const end = ls.findIndex((l) => /^M30/.test(l));
    ls.splice(end, 0, 'M1');
    expect(codes(ls.join('\r\n'), ctx)).toContain('TOOL_CHANGE_OPTIONAL_STOP');
  });
});

describe('T311 tester: auto mode unchanged', () => {
  it('an auto-changer program is clean and never reports the optional stop code', () => {
    const { text, ctx } = program('auto');
    expect(text).toMatch(/^T3 M6/m);
    expect(codes(text, ctx)).toEqual([]);
  });
});
