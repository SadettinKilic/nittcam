import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import { formatFileSize, ruleLabel, shortHash, splitFileName } from './exports-api';

describe('export file rows (T250)', () => {
  it('formats sizes the Turkish way', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(20060)).toBe('20,1 KB');
    expect(formatFileSize(1000)).toBe('1,0 KB');
    expect(formatFileSize(999_949)).toBe('999,9 KB');
    expect(formatFileSize(999_950)).toBe('1,0 MB');
    expect(formatFileSize(1_500_000)).toBe('1,5 MB');
    expect(formatFileSize(12_345_678)).toBe('12,3 MB');
  });

  it('shows the first 8 characters of the hash', () => {
    expect(shortHash('f2acd1f01c0aa9b8e7')).toBe('f2acd1f0');
  });

  it('splits a file name so that head + tail is the name and the tail stays whole', () => {
    expect(splitFileName('mutfak-plaka-1.nc')).toEqual(['mutfa', 'k-plaka-1.nc']);
    expect(splitFileName('a.nc')).toEqual(['', 'a.nc']);
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 30 }), (name, tail) => {
        const [h, t] = splitFileName(name, tail);
        expect(h + t).toBe(name);
        expect(t.length).toBe(Math.min(tail, name.length));
      }),
    );
  });
});

describe('violation group label (T258, D-045)', () => {
  const labels = tr.wizard.export.ruleLabels;
  it('names every check group in Turkish, never the internal code', () => {
    expect(ruleLabel(labels, 'TOOLPATH')).toBe('Takım yolu');
    expect(ruleLabel(labels, 'R3')).toBe('Kural 3');
    expect(ruleLabel(labels, 'R10')).toBe('Kural 10');
    for (const code of ['TOOLPATH', 'POST', 'INPUT', 'MODEL', 'LAYOUT', 'TOOLS', 'XYZ']) {
      expect(ruleLabel(labels, code)).not.toMatch(/^[A-Z]{3,}$/);
    }
  });
});
