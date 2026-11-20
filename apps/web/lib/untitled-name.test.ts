import { describe, expect, it } from 'vitest';
import { isUntitledName, untitledName } from './untitled-name';

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

describe('isUntitledName (T283)', () => {
  it('accepts the base and numbered defaults', () => {
    expect(isUntitledName(BASE, BASE)).toBe(true);
    expect(isUntitledName(BASE, `${BASE} 2`)).toBe(true);
    expect(isUntitledName(BASE, ' adsız proje 12 ')).toBe(true);
  });

  it('rejects user names', () => {
    for (const n of [
      'Mutfak alt dolap 60',
      `${BASE}Mutfak`,
      `${BASE} 1`,
      `${BASE} 02`,
      `${BASE} x`,
      '',
    ])
      expect(isUntitledName(BASE, n)).toBe(false);
  });

  it('accepts every name untitledName hands out', () => {
    const names: string[] = [];
    for (let i = 0; i < 5; i++) names.push(untitledName(BASE, names));
    for (const n of names) expect(isUntitledName(BASE, n)).toBe(true);
  });
});
