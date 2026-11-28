import { describe, expect, it } from 'vitest';
import { defaultMachineProfile } from './defaults';
import { chipLoadBand, stepDownCeiling, traitsOf } from './material-traits';
import {
  materialFamilyIssues,
  parseMachineProfile,
  parseMachineProfileForSave,
  setChipLoad,
  type MachineProfile,
  type MaterialParams,
} from './profile';

// T351: machine parameter table per material family (chip load band, step-down ceiling, ramp).

function withSet(set: Partial<MaterialParams> & Pick<MaterialParams, 'material'>): MachineProfile {
  const p = defaultMachineProfile();
  p.spindle = { ...p.spindle, minRpm: 6000, maxRpm: 24000 };
  p.materials = [
    ...p.materials,
    { thickness: 3, feed: 1800, plungeFeed: 400, rpm: 18000, stepDown: 1.5, tool: 1, ...set },
  ];
  return p;
}
const keys = (p: MachineProfile) => materialFamilyIssues(p).map((i) => i.key);

describe('material family limits (T351)', () => {
  it('aluminium at 5 000 mm/min, 18 000 rpm, 2 flutes is refused with its band', () => {
    const p = withSet({ material: 'aluminium', feed: 5000 });
    const issues = materialFamilyIssues(p);
    expect(issues.map((i) => [i.key, i.path])).toEqual([
      ['chipLoadOutsideBand', `materials[${p.materials.length - 1}].feed`],
    ]);
    expect(issues[0]?.values).toEqual({ value: 0.139, min: 0.04, max: 0.1 });
    const save = parseMachineProfileForSave(p);
    expect(save.ok).toBe(false);
    // a stored profile still loads (save-only rule)
    expect(parseMachineProfile(p).ok).toBe(true);
    // inside the band: 1 800 / (18 000 × 2) = 0,05
    expect(keys(withSet({ material: 'aluminium' }))).toEqual([]);
  });

  it('ACM outside its band is only marked (warn), never refused', () => {
    const p = withSet({ material: 'acm', feed: 20000, stepDown: 4, thickness: 4 });
    expect(keys(p)).toEqual([]);
    const cl = setChipLoad(p, p.materials[p.materials.length - 1] as MaterialParams);
    expect(cl?.value).toBeCloseTo(0.556, 3);
    expect(chipLoadBand(traitsOf('acm'), 6)).toEqual({ min: 0.06, max: 0.21, enforce: 'warn' });
  });

  it('step-down above 0,5 × Ø (light machine 0,25 × Ø) is refused with the limit', () => {
    expect(stepDownCeiling(traitsOf('aluminium'), 6)).toBe(3);
    expect(stepDownCeiling(traitsOf('aluminium'), 6, 'light')).toBe(1.5);
    expect(stepDownCeiling(traitsOf('mdf'), 6)).toBeNull();
    const p = withSet({ material: 'aluminium', stepDown: 3.5 });
    expect(materialFamilyIssues(p).find((i) => i.key === 'stepDownAboveCeiling')?.values).toEqual({
      max: 3,
      share: 0.5,
    });
    p.metal = { enabled: true, rigidity: 'light' };
    const last = p.materials[p.materials.length - 1] as MaterialParams;
    last.stepDown = 2;
    expect(keys(p)).toEqual(['stepDownAboveCeiling']);
    last.stepDown = 1.5;
    expect(keys(p)).toEqual([]);
  });

  it('ramp above the family ceiling is refused; wood rows never get an issue', () => {
    expect(keys(withSet({ material: 'acm', rampDeg: 6, stepDown: 3 }))).toEqual(['rampAboveMax']);
    expect(keys(withSet({ material: 'acm', rampDeg: 5, stepDown: 3 }))).toEqual([]);
    const wood = withSet({ material: 'mdf', feed: 30000, stepDown: 20, thickness: 18 });
    expect(keys(wood)).toEqual([]);
    expect(materialFamilyIssues(defaultMachineProfile())).toEqual([]);
  });

  it('coolant rule texts carry the actual M code', () => {
    const p = defaultMachineProfile();
    p.coolant = { type: 'mist', control: 'program', on: 'M7', off: 'M9' };
    const r = parseMachineProfile(p);
    if (r.ok) throw new Error('expected issues');
    const conflict = r.issues.find((i) => i.key === 'mCodeConflict');
    expect(conflict?.values).toEqual({ code: 'M7' });
    expect(r.issues.find((i) => i.key === 'vacuumUsesCoolantCode')?.values).toEqual({ code: 'M7' });
  });

  it('metal set fields parse; out of bounds is refused', () => {
    const ok = withSet({ material: 'aluminium', coolant: true, finishAllowance: 0.2, rampDeg: 2 });
    expect(parseMachineProfile(ok).ok).toBe(true);
    expect(parseMachineProfile(withSet({ material: 'aluminium', finishAllowance: 3 })).ok).toBe(
      false,
    );
  });
});
