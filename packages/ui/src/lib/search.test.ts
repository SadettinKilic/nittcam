import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { foldTr, fuzzyScore } from './search';

describe('foldTr', () => {
  it('folds Turkish letters and case', () => {
    expect(foldTr('MAKİNE')).toBe('makine');
    expect(foldTr('Makıne')).toBe('makine');
    expect(foldTr('ŞABLONLAR')).toBe('sablonlar');
    expect(foldTr('Işık Çağrı Öğe Ünlü')).toBe('isik cagri oge unlu');
    expect(foldTr('  Yeni   proje ')).toBe('yeni proje');
    expect(foldTr('café')).toBe('cafe');
  });

  it('is idempotent and case-insensitive (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = foldTr(s);
        expect(foldTr(once)).toBe(once);
        expect(foldTr(s.toLocaleUpperCase('tr-TR'))).toBe(foldTr(s.toLocaleLowerCase('tr-TR')));
      }),
    );
  });
});

describe('fuzzyScore', () => {
  it('matches with or without Turkish characters', () => {
    expect(fuzzyScore('Makineler', 'makine')).toBe(1);
    expect(fuzzyScore('Şablonlar', 'sablon')).toBe(1);
    expect(fuzzyScore('Ayarlar', 'ayar')).toBe(1);
    expect(fuzzyScore('Temayı değiştir', 'degistir')).toBeGreaterThan(0.8);
    expect(fuzzyScore('Işık', 'ISIK')).toBe(1);
  });

  it('ranks prefix > word start > inside > scattered letters > none', () => {
    const prefix = fuzzyScore('Projeler', 'pro');
    const word = fuzzyScore('Yeni proje', 'pro');
    const inside = fuzzyScore('Kaproje', 'pro');
    const scattered = fuzzyScore('Makineler', 'mkn');
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
    expect(fuzzyScore('Makineler', 'xyz')).toBe(0);
  });

  it('needs every word, from the value or the keywords', () => {
    expect(fuzzyScore('Yeni proje', 'yeni proje')).toBe(1);
    expect(fuzzyScore('Yeni proje', 'yeni makine')).toBe(0);
    expect(fuzzyScore('Oluştur', 'yeni', ['yeni proje', 'sihirbaz'])).toBe(1);
    expect(fuzzyScore('Anything', '   ')).toBe(1);
  });

  it('stays in [0, 1] (property)', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (v, s) => {
        const score = fuzzyScore(v, s);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('a value always matches itself (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (v) => {
        fc.pre(foldTr(v).length > 0);
        expect(fuzzyScore(v, v)).toBe(1);
      }),
    );
  });
});
