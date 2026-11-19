import { describe, expect, it } from 'vitest';
import { matchesPart } from './part-search';

describe('matchesPart (T135)', () => {
  const p = { name: 'Yan DİKME', note: 'beyaz', group: 'Alt dolap 60' };
  it('empty query matches; Turkish case folding; every word must appear', () => {
    expect(matchesPart(p, '')).toBe(true);
    expect(matchesPart(p, 'dikme')).toBe(true);
    expect(matchesPart(p, 'İ')).toBe(true);
    expect(matchesPart(p, 'yan beyaz')).toBe(true);
    expect(matchesPart(p, 'dolap 60')).toBe(true);
    expect(matchesPart(p, 'raf')).toBe(false);
    expect(matchesPart({ name: 'Raf' }, 'raf')).toBe(true);
  });
});
