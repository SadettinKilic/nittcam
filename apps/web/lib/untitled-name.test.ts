import { describe, expect, it } from 'vitest';
import { untitledName } from './untitled-name';

const BASE = 'Adsız proje';

describe('untitledName', () => {
  it('uses the base when it is free', () => {
    expect(untitledName(BASE, [])).toBe(BASE);
    expect(untitledName(BASE, ['Mutfak dolabı'])).toBe(BASE);
  });

  it('counts up from 2 and fills gaps', () => {
    expect(untitledName(BASE, [BASE])).toBe(`${BASE} 2`);
    expect(untitledName(BASE, [BASE, `${BASE} 2`, `${BASE} 4`])).toBe(`${BASE} 3`);
  });

  it('ignores case (Turkish) and surrounding spaces', () => {
    expect(untitledName(BASE, ['  ADSIZ PROJE '])).toBe(`${BASE} 2`);
  });

  it('never returns a taken name', () => {
    for (let mask = 0; mask < 1 << 6; mask++) {
      const existing = [1, 2, 3, 4, 5, 6]
        .filter((n) => mask & (1 << (n - 1)))
        .map((n) => (n === 1 ? BASE : `${BASE} ${n}`));
      expect(existing).not.toContain(untitledName(BASE, existing));
    }
  });
});
