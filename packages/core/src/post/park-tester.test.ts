/**
 * B55 tester (T309, D-097): mutations of a park program that the independent reader and checker
 * must refuse: G53 only as G0 at the profile's park point, at safe Z, spindle off, immediately
 * followed by a pause, and XY unknown afterwards.
 */
import { describe, expect, it } from 'vitest';
import { checkGcode, type GcodeCheckContext } from '../gcode-check';
import { readGcode } from '../gcode-reader';
import type { MachineProfile } from '../machine';
import type { Toolpath } from '../toolpath';
import { config, metaFor, profileFor, run, sampleToolpath, SHEET } from './post.testing';

const PARK = { enabled: true, x: 50, y: 900 };
const G53 = 'G53 G0 X50.0000 Y900.0000';

function setup(): { profile: MachineProfile; toolpath: Toolpath; text: string } {
  const profile = profileFor('mach3');
  profile.tools.push({ number: 3, type: 'flatEndMill', diameter: 6, fluteLength: 25, flutes: 2 });
  profile.toolChanger.park = PARK;
  const toolpath = sampleToolpath(profile);
  const second = toolpath.operations[1];
  if (!second) throw new Error('sample toolpath needs two operations');
  second.tool = 3;
  second.toolDiameter = 6;
  const r = run({ toolpath, profile, config: config('mach3') });
  expect(r.errors).toEqual([]);
  return { profile, toolpath, text: r.files[0]?.content ?? '' };
}

const { profile, toolpath, text } = setup();
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
const errorCodes = (t: string) =>
  checkGcode(t, ctx)
    .violations.filter((v) => v.severity === 'error')
    .map((v) => v.code);
const lines = text.split('\r\n');
const join = (ls: string[]) => ls.join('\r\n');
/** Index of the last tool-change park line (T2 → T3); T335 adds an end park after it. */
const parkAt = lines.lastIndexOf(G53, lines.lastIndexOf('M0'));
const pauseAt = lines.indexOf('M0', parkAt);

/** Replace the lines [from, to) after the last park with `insert`. */
function edit(from: number, to: number, insert: string[]): string {
  return join([...lines.slice(0, from), ...insert, ...lines.slice(to)]);
}

describe('B55 tester: G53 park mutations are refused', () => {
  it('baseline: the generated program is clean and has the park before the pause', () => {
    expect(parkAt).toBeGreaterThan(0);
    expect(pauseAt).toBeGreaterThan(parkAt);
    expect(errorCodes(text)).toEqual([]);
  });

  it.each([
    ['G53 as a feed move', () => edit(parkAt, parkAt + 1, ['G53 G1 X50.0000 Y900.0000 F1000'])],
    ['G53 with only X', () => edit(parkAt, parkAt + 1, ['G53 G0 X50.0000'])],
    ['G53 at another point', () => edit(parkAt, parkAt + 1, ['G53 G0 X50.0000 Y899.0000'])],
    ['no pause after the park', () => edit(pauseAt, pauseAt + 1, [])],
    ['a move between park and pause', () => edit(pauseAt, pauseAt, ['G0 X10.0000 Y10.0000'])],
    ['spindle started before the park', () => edit(parkAt, parkAt, ['M3 S18000', 'G4 P5'])],
  ])('%s', (_name, mutate) => {
    const t = mutate();
    expect(t).not.toBe(text);
    expect(errorCodes(t).length, errorCodes(t).join()).toBeGreaterThan(0);
  });

  it('spindle started between park and pause (tool changed with spindle on) is refused', () => {
    const t = edit(pauseAt, pauseAt, ['M3 S18000', 'G4 P5']);
    expect(errorCodes(t).length).toBeGreaterThan(0);
  });

  it('XY unknown after the park: a sheet move must write X and Y before cutting', () => {
    // Find the first XY rapid after the pause and drop its Y word.
    const k = lines.findIndex((l, i) => i > pauseAt && /^G0 X-?[\d.]+ Y-?[\d.]+$/.test(l));
    expect(k).toBeGreaterThan(pauseAt);
    const onlyX = edit(k, k + 1, [(lines[k] ?? '').replace(/ Y-?[\d.]+/, '')]);
    expect(errorCodes(onlyX).length).toBeGreaterThan(0);
    const none = edit(k, k + 1, []);
    expect(errorCodes(none).length).toBeGreaterThan(0);
  });

  it.each(['G53 G0 X50 Y900 Z0', 'G53 G4 P1', 'G53 G81 X1 Y1 Z-1 R2', 'G53 G3 X1 Y1 I1 J0'])(
    'the reader refuses %s',
    (block) => {
      const r = readGcode(`G21 G90\nG0 Z20\n${block}\nM30`);
      expect(r.errors.map((f) => f.code)).toContain('UNSUPPORTED_CODE');
    },
  );

  it('G53 does not change the work XY the reader keeps for later moves', () => {
    const r = readGcode('G21 G90\nG0 Z20\nG0 X10 Y10\nG53 G0 X50 Y900\nM0\nG0 X20\nM30');
    expect(r.errors).toEqual([]);
    // After 'G0 X20' the work Y is still unknown (only X was written after the park).
    expect(r.lines.at(-2)?.state.assumedAxes).toEqual(['y']);
  });
});
