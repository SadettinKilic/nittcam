/**
 * T335 tester (B63): hand edits of the end-at-park sequence that a machinist could make (or a bug
 * could produce) are refused by the independent checker. Complements `park-end.t335.test.ts`.
 * Note: the checker does not enforce M5 before M9 at the end (vacuum off first at safe Z passes);
 * the generator writes M5 first. Reported to the PO as a non-blocking note.
 */
import { describe, expect, it } from 'vitest';
import { checkGcode, type GcodeCheckContext } from '../gcode-check';
import { config, metaFor, profileFor, run, sampleToolpath, SHEET } from './post.testing';

const PARK = { enabled: true, x: 50, y: 900 };
const G53 = 'G53 G0 X50.0000 Y900.0000';

const profile = profileFor('mach3');
profile.toolChanger.park = PARK;
const toolpath = sampleToolpath(profile);
const r = run({ toolpath, profile, config: config('mach3') });
const text = r.files[0]?.content ?? '';
const lines = text.split('\r\n');
const endPark = lines.lastIndexOf(G53);
const m5 = lines.lastIndexOf('M5');
const ctx: GcodeCheckContext = {
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
};
const errors = (t: string) =>
  checkGcode(t, ctx)
    .violations.filter((v) => v.severity === 'error')
    .map((v) => v.code);
const join = (ls: string[]) => ls.join('\r\n');

describe('T335 tester: end-at-park hand edits', () => {
  it('the generated end is accepted and has the expected order', () => {
    expect(r.errors).toEqual([]);
    expect(endPark).toBeGreaterThan(m5);
    expect(errors(text)).toEqual([]);
  });

  it.each([
    [
      'a cutting move after the end park',
      () =>
        join([
          ...lines.slice(0, endPark + 1),
          'G1 Z-5.0000 F1000',
          'G1 X100.0000 F6000',
          ...lines.slice(endPark + 1),
        ]),
    ],
    [
      'park before M5 with Z down',
      () => {
        // move the end park above M5 and drop Z into the material before it
        const without = lines.filter((_, i) => i !== endPark);
        const at = without.lastIndexOf('M5');
        return join([...without.slice(0, at), 'G1 Z-5.0000 F1000', G53, ...without.slice(at)]);
      },
    ],
    [
      'park before M5 (spindle still on, Z safe)',
      () => {
        const without = lines.filter((_, i) => i !== endPark);
        const at = without.lastIndexOf('M5');
        return join([...without.slice(0, at), G53, ...without.slice(at)]);
      },
    ],
    [
      'end park at another X',
      () => join(lines.map((l, i) => (i === endPark ? 'G53 G0 X60.0000 Y900.0000' : l))),
    ],
  ])('%s is refused', (_name, mutate) => {
    const t = mutate();
    expect(t).not.toBe(text);
    expect(errors(t).length, errors(t).join()).toBeGreaterThan(0);
  });
});
