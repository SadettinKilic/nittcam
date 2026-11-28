import { defaultMachineProfile, machineProfileSchema } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { withSampleVBit } from './sample-vbit';

describe('sample V-bit (B70 rider)', () => {
  it('adds a 90° V-bit (Ø12, tip 0,2) at the next free number when the machine has none', () => {
    const p = defaultMachineProfile();
    expect(p.tools.some((t) => t.type === 'vBit')).toBe(false);
    const r = withSampleVBit(p);
    expect(r.added).toBe(true);
    const vBits = r.profile.tools.filter((t) => t.type === 'vBit');
    expect(vBits).toHaveLength(1);
    expect(vBits[0]).toMatchObject({ diameter: 12, angleDeg: 90, tipDiameter: 0.2 });
    expect(new Set(r.profile.tools.map((t) => t.number)).size).toBe(r.profile.tools.length);
    // The tool rows are valid.
    const issues = machineProfileSchema.safeParse(r.profile).error?.issues ?? [];
    expect(issues.filter((i) => i.path[0] === 'tools')).toEqual([]);
  });

  it('never a second one', () => {
    const once = withSampleVBit(defaultMachineProfile()).profile;
    const twice = withSampleVBit(once);
    expect(twice.added).toBe(false);
    expect(twice.profile).toBe(once);
  });
});
