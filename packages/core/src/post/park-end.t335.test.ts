/**
 * T335 (field rehearsal N2, D-127): with the park on (T309, G53 point, manual changer) the program
 * ends safe Z → spindle off → park → vacuum off → end code, so the sheet is free for unloading. The
 * independent checker accepts the end G53 only at the profile's park point, with nothing moving
 * after it. Park off (or an auto changer, or no G53) = the old end, byte for byte.
 */
import { describe, expect, it } from 'vitest';
import { checkGcode, type GcodeCheckContext } from '../gcode-check';
import type { MachineProfile } from '../machine';
import type { Toolpath } from '../toolpath';
import { config, metaFor, profileFor, run, sampleToolpath, SHEET } from './post.testing';

const PARK = { enabled: true, x: 50, y: 900 };
const G53 = 'G53 G0 X50.0000 Y900.0000';

function setup(park?: MachineProfile['toolChanger']['park']): {
  profile: MachineProfile;
  toolpath: Toolpath;
  text: string;
} {
  const profile = profileFor('mach3');
  if (park) profile.toolChanger.park = park;
  const toolpath = sampleToolpath(profile);
  const r = run({ toolpath, profile, config: config('mach3') });
  expect(r.errors).toEqual([]);
  return { profile, toolpath, text: r.files[0]?.content ?? '' };
}

const ctxOf = (profile: MachineProfile, toolpath: Toolpath): GcodeCheckContext => ({
  profile,
  verification: 'draft',
  post: config('mach3'),
  toolpath,
  stock: {
    thickness: metaFor().stock.thickness,
    sheetWidth: SHEET.width,
    sheetHeight: SHEET.height,
  },
  sheet: 0,
});

const on = setup(PARK);
const ctx = ctxOf(on.profile, on.toolpath);
const errorCodes = (t: string) =>
  checkGcode(t, ctx)
    .violations.filter((v) => v.severity === 'error')
    .map((v) => v.code);
const lines = on.text.split('\r\n');
const join = (ls: string[]) => ls.join('\r\n');
const endPark = lines.lastIndexOf(G53);
const codeLines = (ls: string[]) => ls.filter((l) => l !== '' && !l.startsWith('('));

describe('end at the park point (T335)', () => {
  it('park on: safe Z, M5, park, vacuum off, M30 at the end; the checker accepts it', () => {
    const tail = codeLines(lines).slice(-5);
    expect(tail[0]).toMatch(/^G0 Z20\.0+$/);
    expect(tail.slice(1)).toEqual(['M5', G53, 'M9', 'M30']);
    expect(errorCodes(on.text)).toEqual([]);
    // the end park carries its own comment and the homing note, ASCII only
    const notes = lines.slice(endPark - 3, endPark).join('\n');
    expect(notes).toContain('PROGRAM SONU');
    expect(notes).toContain('HOME');
    expect(on.text).toMatch(/^[\x20-\x7e\r\n]*$/);
  });

  it('park off, no G53 or an auto changer: the old end, byte for byte', () => {
    const off = setup();
    const disabled = setup({ ...PARK, enabled: false });
    expect(disabled.text).toBe(off.text);
    expect(off.text).not.toContain('G53');
    expect(codeLines(off.text.split('\r\n')).slice(-3)).toEqual(['M5', 'M9', 'M30']);
    // generic post (no G53): nothing changes either
    const g = profileFor('generic');
    g.toolChanger.park = PARK;
    const gtp = sampleToolpath(g);
    const plain = profileFor('generic');
    const a = run({ toolpath: gtp, profile: g, config: config('generic') });
    const b = run({ toolpath: sampleToolpath(plain), profile: plain, config: config('generic') });
    expect(a.files[0]?.content).toBe(b.files[0]?.content);
  });

  it.each([
    [
      'end park at another point',
      () => join(lines.map((l, i) => (i === endPark ? 'G53 G0 X50.0000 Y899.0000' : l))),
    ],
    [
      'end park as a feed move',
      () => join(lines.map((l, i) => (i === endPark ? 'G53 G1 X50.0000 Y900.0000 F1000' : l))),
    ],
    [
      'a move after the end park',
      () =>
        join([...lines.slice(0, endPark + 1), 'G0 X10.0000 Y10.0000', ...lines.slice(endPark + 1)]),
    ],
    [
      'spindle on at the end park',
      () => join(lines.filter((l, i) => !(l === 'M5' && i < endPark && i > endPark - 6))),
    ],
    [
      'end park below safe Z',
      () => join([...lines.slice(0, endPark), 'G0 Z2.0000', ...lines.slice(endPark)]),
    ],
  ])('%s is refused', (_name, mutate) => {
    const t = mutate();
    expect(t).not.toBe(on.text);
    expect(errorCodes(t).length, errorCodes(t).join()).toBeGreaterThan(0);
  });
});
