import { describe, expect, it } from 'vitest';
import { defaultMachineProfile } from '../machine';
import { nestingToolDiameter } from './tool';

describe('nestingToolDiameter', () => {
  const profile = defaultMachineProfile();

  it('uses the suggested tool of the matching material set (MDF 18 → T2 8 mm)', () => {
    expect(nestingToolDiameter(profile, { material: 'mdf', thickness: 18 })).toBe(8);
  });

  it('falls back to the largest end mill when no material set matches', () => {
    expect(nestingToolDiameter(profile, { material: 'plywood', thickness: 12 })).toBe(8);
    const drills = {
      materials: [],
      tools: [
        { number: 1, type: 'drill' as const, diameter: 5, fluteLength: 20, flutes: 2 },
        { number: 2, type: 'flatEndMill' as const, diameter: 6, fluteLength: 20, flutes: 2 },
      ],
    };
    expect(nestingToolDiameter(drills, { material: 'mdf', thickness: 18 })).toBe(6);
  });

  it('undefined without tools', () => {
    expect(
      nestingToolDiameter({ tools: [], materials: [] }, { material: 'mdf', thickness: 18 }),
    ).toBe(undefined);
  });
});
