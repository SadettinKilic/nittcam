/**
 * T309 (D-097): park point for a manual tool change, in MACHINE coordinates. With the park on and a
 * post that takes G53, a manual pause is preceded by safe Z and `G53 G0 X.. Y..`; the independent
 * reader accepts that move only at the profile's park point. Park off (or no G53) = the old program.
 */
import { describe, expect, it } from 'vitest';
import { checkGcode, type GcodeCheckContext } from '../gcode-check';
import { readGcode } from '../gcode-reader';
import { machineProfileSchema, type MachineProfile } from '../machine';
import type { Toolpath } from '../toolpath';
import type { PostConfig } from './config';
import { config, metaFor, profileFor, run, sampleToolpath, SHEET } from './post.testing';

/** Mach3 (manual changer) with T2 then T3, so there is one real tool change. */
function twoTools(park?: MachineProfile['toolChanger']['park']): {
  profile: MachineProfile;
  toolpath: Toolpath;
} {
  const profile = profileFor('mach3');
  profile.tools.push({ number: 3, type: 'flatEndMill', diameter: 6, fluteLength: 25, flutes: 2 });
  if (park) profile.toolChanger.park = park;
  const toolpath = sampleToolpath(profile);
  const second = toolpath.operations[1];
  if (!second) throw new Error('sample toolpath needs two operations');
  second.tool = 3;
  second.toolDiameter = 6;
  return { profile, toolpath };
}

function program(profile: MachineProfile, toolpath: Toolpath, cfg = config('mach3')): string {
  const r = run({ toolpath, profile, config: cfg });
  expect(r.errors).toEqual([]);
  return r.files[0]?.content ?? '';
}

function context(
  profile: MachineProfile,
  toolpath: Toolpath,
  post: PostConfig = config('mach3'),
): GcodeCheckContext {
  return {
    profile,
    verification: 'draft',
    post,
    toolpath,
    stock: {
      thickness: metaFor().stock.thickness,
      sheetWidth: SHEET.width,
      sheetHeight: SHEET.height,
    },
    sheet: 0,
  };
}

const errors = (text: string, ctx: GcodeCheckContext) =>
  checkGcode(text, ctx).violations.filter((v) => v.severity === 'error');
const codes = (text: string, ctx: GcodeCheckContext) => errors(text, ctx).map((v) => v.code);

const PARK = { enabled: true, x: 50, y: 900 };
const PARK_COMMENT = '(PARK: TAKIM DEGISIM NOKTASI MAKINE KOORDINATI)';

function noG53(): PostConfig {
  const c = config('mach3');
  c.motion.machineCoordinates = false;
  return c;
}

describe('park point for a manual tool change (T309, G53)', () => {
  it('park off or absent: the program is unchanged', () => {
    const plain = twoTools();
    const off = twoTools({ ...PARK, enabled: false });
    expect(program(off.profile, off.toolpath)).toBe(program(plain.profile, plain.toolpath));
  });

  it('a post without G53 keeps the park off (program unchanged)', () => {
    const plain = twoTools();
    const on = twoTools(PARK);
    expect(program(on.profile, on.toolpath, noG53())).toBe(
      program(plain.profile, plain.toolpath, noG53()),
    );
  });

  it('park on: safe Z, G53 park rapid, message and M0 before every manual pause', () => {
    const { profile, toolpath } = twoTools(PARK);
    const lines = program(profile, toolpath).split('\r\n');
    const pauses = lines.flatMap((l, i) => (l === 'M0' ? [i] : []));
    expect(pauses.length).toBeGreaterThanOrEqual(2); // first tool check + the changes
    for (const k of pauses) {
      const at = lines.lastIndexOf(PARK_COMMENT, k);
      expect(at).toBeGreaterThan(0);
      const zBefore = lines
        .slice(0, at)
        .reverse()
        .find((l) => /Z-?\d/.test(l));
      expect(zBefore).toMatch(/Z20\.0000/);
      expect(lines[at + 1]).toBe('G53 G0 X50.0000 Y900.0000');
      // T332 (field rehearsal S1): the machine must be homed for G53; said right before the park.
      expect(lines[at - 1]).toBe('(PARK ICIN MAKINE HOME EDILMIS OLMALI)');
      expect(lines.slice(at + 2, k).every((l) => l.startsWith('('))).toBe(true);
      expect(lines[k + 1]).toBe('G0 Z20.0000');
    }
    // After the pause XY is unknown: the next XY move writes both X and Y.
    const next = lines.slice((pauses[1] ?? 0) + 2).find((l) => /^G0 X/.test(l));
    expect(next).toMatch(/^G0 X-?[\d.]+ Y-?[\d.]+$/);
  });

  it('the independent reader accepts the park program', () => {
    const { profile, toolpath } = twoTools(PARK);
    expect(errors(program(profile, toolpath), context(profile, toolpath))).toEqual([]);
  });

  it('the reader refuses a G53 move the profile or post does not declare, or a moved one', () => {
    const { profile, toolpath } = twoTools(PARK);
    const text = program(profile, toolpath);
    const without = structuredClone(profile);
    delete without.toolChanger.park;
    expect(codes(text, context(without, toolpath))).toContain('MACHINE_MOVE');
    const moved = structuredClone(profile);
    moved.toolChanger.park = { ...PARK, x: 60 };
    expect(codes(text, context(moved, toolpath))).toContain('MACHINE_MOVE');
    expect(codes(text, context(profile, toolpath, noG53()))).toContain('MACHINE_MOVE');
  });

  it('the reader refuses a G53 park below safe Z', () => {
    const { profile, toolpath } = twoTools(PARK);
    const text = program(profile, toolpath);
    const low = text.replace(`${PARK_COMMENT}\r\nG53`, '(PARK)\r\nG0 Z1.0000\r\nG53');
    expect(low).not.toBe(text);
    expect(codes(low, context(profile, toolpath))).toContain('MACHINE_MOVE');
  });

  it('a park point outside the machine travel is refused by the generator (rule 6)', () => {
    const { profile, toolpath } = twoTools(PARK);
    profile.toolChanger.park = { enabled: true, x: profile.workEnvelope.x + 100, y: 0 };
    const r = run({ toolpath, profile, config: config('mach3') });
    expect(r.ok).toBe(false);
  });
});

describe('G53 in the reader (T309)', () => {
  const PRE = 'G21 G90 G17 G54\nG0 Z20\nG0 X10 Y10\n';

  it('reads G53 G0 X Y as a machine move event; XY unknown afterwards, no move recorded', () => {
    const r = readGcode(`${PRE}G53 G0 X-5 Y-900\n`);
    expect(r.errors).toEqual([]);
    expect(r.moves).toHaveLength(2);
    expect(r.events.at(-1)).toMatchObject({ kind: 'machineMove', motion: 'G0', x: -5, y: -900 });
    expect(r.lines.at(-1)?.state.assumedAxes).toEqual(['x', 'y']);
  });

  it.each(['G53 G0 Z0', 'G53 G0 X1 Z0', 'G53 G2 X1 Y1 R5', 'G91 G53 G0 X1', 'G53'])(
    '%s is still an error',
    (line) => {
      const r = readGcode(`${PRE}${line}\n`);
      expect(r.errors.map((e) => e.code)).toContain('UNSUPPORTED_CODE');
      expect(r.moves).toHaveLength(2);
    },
  );
});

describe('park point in the machine profile (T309)', () => {
  const issues = (p: MachineProfile) =>
    machineProfileSchema.safeParse(p).error?.issues.map((i) => i.path.join('.')) ?? [];

  it('is optional and valid within the machine travel, either sign', () => {
    const p = profileFor('mach3');
    expect(issues(p)).toEqual([]);
    p.toolChanger.park = { enabled: true, x: 10, y: p.workEnvelope.y };
    expect(issues(p)).toEqual([]);
    p.toolChanger.park = { enabled: true, x: -p.workEnvelope.x, y: -10 };
    expect(issues(p)).toEqual([]);
  });

  it('outside the travel is a field error; off ignores the values', () => {
    const p = profileFor('mach3');
    p.toolChanger.park = { enabled: true, x: p.workEnvelope.x + 1, y: -(p.workEnvelope.y + 1) };
    expect(issues(p)).toEqual(['toolChanger.park.x', 'toolChanger.park.y']);
    p.toolChanger.park.enabled = false;
    expect(issues(p)).toEqual([]);
  });
});
