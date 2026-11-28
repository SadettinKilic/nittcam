import { defaultMachineProfile, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { vGrooveInfoOf } from './vgroove-info';

// T352: the drawing board offers "V-kanal (büküm)" only on ACM and lists the machine's V-bits.
const project = (material: string) =>
  ({ stock: { material, thickness: 4 }, parts: [], cutting: {} }) as unknown as Project;

describe('vGrooveInfoOf (T352)', () => {
  it('no traits on MDF and aluminium; ACM lists the V-bits with an angle and picks the lowest', () => {
    const m = defaultMachineProfile();
    m.tools = [
      ...m.tools,
      { number: 9, type: 'vBit', diameter: 12, fluteLength: 10, flutes: 2, angleDeg: 90 },
      { number: 6, type: 'vBit', diameter: 12, fluteLength: 10, flutes: 2 },
    ];
    expect(vGrooveInfoOf(project('mdf'), m).traits).toBeNull();
    expect(vGrooveInfoOf(project('aluminium'), m).traits).toBeNull();
    const acm = vGrooveInfoOf(project('acm'), m);
    expect(acm.traits?.defaultRemaining).toBe(0.8);
    expect(acm.vBits.map((t) => t.number)).toEqual([9]);
    expect(acm.tool?.number).toBe(9);
    expect(vGrooveInfoOf(project('acm'), null).vBits).toEqual([]);
  });
});
