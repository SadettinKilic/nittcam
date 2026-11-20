/**
 * T309: park point for a manual tool change. With the park on, a manual pause is preceded by safe Z
 * and a rapid to the park X/Y at safe Z; the independent reader accepts that move only when the
 * profile has the park point. With the park off, the program is byte for byte the old one.
 */
import { describe, expect, it } from 'vitest';
import { checkGcode, type GcodeCheckContext } from '../gcode-check';
import { machineProfileSchema, type MachineProfile } from '../machine';
import type { Toolpath } from '../toolpath';
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
  toolpath.operations[1]!.tool = 3;
  toolpath.operations[1]!.toolDiameter = 6;
  return { profile, toolpath };
}

function program(profile: MachineProfile, toolpath: Toolpath): string {
  const r = run({ toolpath, profile, config: config('mach3') });
  expect(r.errors).toEqual([]);
  return r.files[0]!.content;
}

function context(profile: MachineProfile, toolpath: Toolpath): GcodeCheckContext {
  return {
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
}

const errors = (text: string, ctx: GcodeCheckContext) =>
  checkGcode(text, ctx).violations.filter((v) => v.severity === 'error');

describe('park point for a manual tool change (T309)', () => {
  it('park off or absent: the program is unchanged', () => {
    const plain = twoTools();
    const off = twoTools({ enabled: false, x: 50, y: 900 });
    expect(program(off.profile, off.toolpath)).toBe(program(plain.profile, plain.toolpath));
  });

  it('park on: safe Z, park rapid, message and M0 before every manual pause', () => {
    const { profile, toolpath } = twoTools({ enabled: true, x: 50, y: 900 });
    const lines = program(profile, toolpath).split('\r\n');
    const pauses = lines.flatMap((l, i) => (l === 'M0' ? [i] : []));
    expect(pauses.length).toBeGreaterThanOrEqual(2); // first tool check + the changes (T2→T3→T2)
    for (const k of pauses) {
      const at = lines.lastIndexOf('(PARK: TAKIM DEGISIM NOKTASI)', k);
      expect(at).toBeGreaterThan(0);
      // Safe Z before the park rapid (rule 2): the last Z word written before it is the safe Z.
      const zBefore = lines
        .slice(0, at)
        .reverse()
        .find((l) => /Z-?\d/.test(l));
      expect(zBefore).toMatch(/Z20\.0000/);
      expect(lines[at + 1]).toBe('G0 X50.0000 Y900.0000');
      // Then only the message and the pause; afterwards safe Z again (XY unknown).
      expect(lines.slice(at + 2, k).every((l) => l.startsWith('('))).toBe(true);
      expect(lines[k + 1]).toBe('G0 Z20.0000');
    }
  });

  it('the independent reader accepts the park program', () => {
    const { profile, toolpath } = twoTools({ enabled: true, x: 50, y: 900 });
    expect(errors(program(profile, toolpath), context(profile, toolpath))).toEqual([]);
  });

  it('the reader refuses a park rapid the profile does not declare', () => {
    const { profile, toolpath } = twoTools({ enabled: true, x: 50, y: 900 });
    const text = program(profile, toolpath);
    const without = structuredClone(profile);
    delete without.toolChanger.park;
    expect(errors(text, context(without, toolpath)).length).toBeGreaterThan(0);
    const moved = structuredClone(profile);
    moved.toolChanger.park = { enabled: true, x: 60, y: 900 };
    expect(errors(text, context(moved, toolpath)).length).toBeGreaterThan(0);
  });

  it('a park point outside the work envelope is refused by the generator (rule 6)', () => {
    const { profile, toolpath } = twoTools({ enabled: true, x: 50, y: 900 });
    profile.toolChanger.park = { enabled: true, x: profile.workEnvelope.x + 100, y: 0 };
    const r = run({ toolpath, profile, config: config('mach3') });
    expect(r.ok).toBe(false);
  });
});

describe('park point in the machine profile (T309)', () => {
  const issues = (p: MachineProfile) =>
    machineProfileSchema.safeParse(p).error?.issues.map((i) => i.path.join('.')) ?? [];

  it('is optional and valid on the table', () => {
    const p = profileFor('mach3');
    expect(issues(p)).toEqual([]);
    p.toolChanger.park = { enabled: true, x: 10, y: p.table.depth - 10 };
    expect(issues(p)).toEqual([]);
  });

  it('off the table (or behind program zero) is a field error; off ignores the values', () => {
    const p = profileFor('mach3');
    p.toolChanger.park = { enabled: true, x: -5, y: p.table.depth + 1 };
    expect(issues(p)).toEqual(['toolChanger.park.x', 'toolChanger.park.y']);
    p.toolChanger.park.enabled = false;
    expect(issues(p)).toEqual([]);
  });

  it('follows the origin corner and axis directions', () => {
    const p = profileFor('mach3');
    p.origin.corner = 'frontRight';
    p.origin.xPositive = 'right';
    // Zero at the front right, +X to the right: the table is at negative X.
    p.toolChanger.park = { enabled: true, x: -100, y: 100 };
    expect(issues(p)).toEqual([]);
    p.toolChanger.park.x = 100;
    expect(issues(p)).toEqual(['toolChanger.park.x']);
  });
});
