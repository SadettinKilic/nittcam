import { describe, expect, it } from 'vitest';
import { goldenProfile } from '../post/golden.testing';
import { defaultMachineProfile } from './defaults';
import { parseMachineProfile, parseMachineProfileForSave, type MachineProfile } from './profile';
import { profileChanges, verificationAfterChange } from './verification';

// T345 (§7.1 "Soğutma", "Metal kesim"; analysis §6.1, §6.2): optional coolant, metal declaration
// and clamp height; the M-code conflict rules apply only to program-controlled coolant.

const base = (): MachineProfile => structuredClone(defaultMachineProfile());

const keys = (p: unknown) => {
  const r = parseMachineProfile(p);
  return r.ok ? [] : r.issues.map((i) => `${i.path}:${i.key ?? i.code}`);
};

describe('machine profile: coolant, metal, clamp height (T345)', () => {
  it('today: the example profile (vacuum M7/M9) has none and saves as before', () => {
    const p = base();
    expect(p.holdDown).toEqual({ type: 'vacuum', vacuumOn: 'M7', vacuumOff: 'M9' });
    expect(keys(p)).toEqual([]);
    expect(parseMachineProfileForSave(p).ok).toBe(true);
    for (const json of [p, goldenProfile('generic'), goldenProfile('mach3')]) {
      const r = parseMachineProfile(structuredClone(json));
      expect(r.ok && r.profile).toEqual(json);
      if (r.ok) expect(Object.keys(r.profile)).not.toContain('coolant');
      if (r.ok) expect(Object.keys(r.profile)).not.toContain('metal');
    }
  });

  it('example profile (vacuum M7) + coolant M8/M9 is refused with both rules', () => {
    const p = { ...base(), coolant: { type: 'flood', control: 'program', on: 'M8', off: 'M9' } };
    expect(keys(p)).toEqual([
      'coolant.off:mCodeConflict',
      'holdDown.vacuumOn:vacuumUsesCoolantCode',
      'holdDown.vacuumOff:vacuumUsesCoolantCode',
    ]);
  });

  it('the fix: vacuum on its own outputs (M10/M11) or empty codes', () => {
    const coolant = { type: 'mist', control: 'program', on: 'm7', off: 'M9' } as const;
    const moved = {
      ...base(),
      coolant,
      holdDown: { type: 'vacuum', vacuumOn: 'M10', vacuumOff: 'M11' },
    };
    expect(keys(moved)).toEqual([]);
    const r = parseMachineProfile(moved);
    expect(r.ok && r.profile.coolant).toEqual({ ...coolant, on: 'M7' });
    const manualVacuum = {
      ...base(),
      coolant,
      holdDown: { type: 'vacuum', vacuumOn: '', vacuumOff: '' },
    };
    expect(keys(manualVacuum)).toEqual([]);
  });

  it('a shared non-coolant code is a conflict too; program coolant needs an on code', () => {
    const p = {
      ...base(),
      holdDown: { type: 'vacuum', vacuumOn: 'M10', vacuumOff: 'M11' },
      coolant: { type: 'air', control: 'program', on: 'M10', off: 'M12' },
    };
    expect(keys(p)).toEqual(['coolant.on:mCodeConflict']);
    expect(keys({ ...p, coolant: { ...p.coolant, on: '' } })).toEqual([
      'coolant.on:coolantOnMissing',
    ]);
  });

  it('rules only for program-controlled coolant: manual, none and clamp hold-down pass', () => {
    const manual = { ...base(), coolant: { type: 'mist', control: 'manual', on: '', off: '' } };
    expect(keys(manual)).toEqual([]);
    const none = { ...base(), coolant: { type: 'none', control: 'program', on: 'M7', off: 'M9' } };
    expect(keys(none)).toEqual([]);
    const clamp = {
      ...base(),
      holdDown: { type: 'clamp', vacuumOn: 'M7', vacuumOff: 'M9' },
      coolant: { type: 'mist', control: 'program', on: 'M7', off: 'M9' },
    };
    expect(keys(clamp)).toEqual([]);
  });

  it('safe Z ≥ clamp height + 5 for clamp and T-slot', () => {
    const p = (type: 'clamp' | 'tSlot' | 'vacuum', clampHeight: number, safeZ: number) => ({
      ...base(),
      safeZ,
      holdDown: { type, vacuumOn: '', vacuumOff: '', clampHeight },
    });
    expect(keys(p('clamp', 25, 30))).toEqual([]);
    expect(keys(p('clamp', 25, 29.9))).toEqual([
      'safeZ:safeZBelowClamps',
      'holdDown.clampHeight:safeZBelowClamps',
    ]);
    expect(keys(p('tSlot', 25, 29.9))).toHaveLength(2);
    expect(keys(p('vacuum', 25, 10))).toEqual([]);
  });

  it('metal declaration: optional, strict values', () => {
    expect(keys({ ...base(), metal: { enabled: true, rigidity: 'light' } })).toEqual([]);
    expect(keys({ ...base(), metal: { enabled: true, rigidity: 'soft' } })).toEqual([
      'metal.rigidity:invalid_value',
    ]);
  });

  it('a coolant or metal edit is a profile change (re-verification as for any edit)', () => {
    const prev = base();
    const next = { ...base(), metal: { enabled: true, rigidity: 'standard' as const } };
    expect(profileChanges(prev, next)).toEqual(['profile']);
    expect(verificationAfterChange({ profile: prev, state: 'verified' }, next).reverifyNeeded).toBe(
      true,
    );
  });
});
