import type { SimMachineFrame } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { simBounds } from '../components/simulation/model';

describe('simBounds (T245)', () => {
  it('keeps the dashed travel outline inside the fit, with a margin', () => {
    const machine: SimMachineFrame = {
      zero: { x: -20, y: -15 },
      xSign: 1,
      ySign: 1,
      table: { x: -20, y: -15, width: 3050, height: 2150 },
      envelope: { x: -20, y: -15, width: 3100, height: 2200 },
    };
    const b = simBounds({ width: 2800, height: 2070 }, machine);
    const e = machine.envelope;
    expect(b.x).toBeLessThan(e.x);
    expect(b.y).toBeLessThan(e.y);
    expect(b.x + b.width).toBeGreaterThan(e.x + e.width);
    expect(b.y + b.height).toBeGreaterThan(e.y + e.height);
  });
});
