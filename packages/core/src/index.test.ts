import { describe, expect, it } from 'vitest';
import { inchesToMm } from './index';

describe('inchesToMm', () => {
  it('converts with the exact 25.4 factor', () => {
    expect(inchesToMm(1)).toBe(25.4);
    expect(inchesToMm(0)).toBe(0);
    expect(inchesToMm(-2)).toBe(-50.8);
  });
});
