/** Number formatting (rule 8), comment sanitising, transliteration and file names (T017). */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildFileName,
  formatComment,
  formatFixed,
  formatFixedCeil,
  PostFormatError,
  sanitizeComment,
  sanitizeFileStem,
  transliterateTurkish,
} from './format';

describe('formatFixed (rule 8)', () => {
  it('random floats: fixed decimals, no exponent/NaN/-0, round trip within 10^-d', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 6 }),
        (v, d) => {
          const s = formatFixed(v, d);
          expect(s).toMatch(d === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${d}}$`));
          expect(s).not.toMatch(/[eE]|NaN|Infinity/);
          expect(s).not.toMatch(/^-0(\.0*)?$/);
          expect(s).not.toBe('');
          expect(Math.abs(Number(s) - v)).toBeLessThanOrEqual(10 ** -d / 2 + Math.abs(v) * 1e-15);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('tiny values and negative zero are written without a sign', () => {
    expect(formatFixed(-0, 3)).toBe('0.000');
    expect(formatFixed(-0.0004, 3)).toBe('0.000');
    expect(formatFixed(1e-12, 3)).toBe('0.000');
    expect(formatFixed(-0.0005001, 3)).toBe('-0.001');
    expect(formatFixed(6000, 0)).toBe('6000');
    expect(formatFixed(1e-7, 4)).toBe('0.0000');
  });

  it('throws on NaN, Infinity, huge values and bad decimal counts', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e21, 2e7]) {
      expect(() => formatFixed(v, 3)).toThrow(PostFormatError);
    }
    expect(() => formatFixed(1, 7)).toThrow(PostFormatError);
    expect(() => formatFixed(1, -1)).toThrow(PostFormatError);
    expect(() => formatFixed('1' as unknown as number, 3)).toThrow(PostFormatError);
  });

  it('formatFixedCeil never shortens (dwell)', () => {
    expect(formatFixedCeil(5, 1)).toBe('5.0');
    expect(formatFixedCeil(2.01, 1)).toBe('2.1');
    expect(formatFixedCeil(0.04, 1)).toBe('0.1');
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 600, noNaN: true }),
        fc.integer({ min: 0, max: 3 }),
        (v, d) => {
          expect(Number(formatFixedCeil(v, d))).toBeGreaterThanOrEqual(v - 1e-9);
        },
      ),
    );
  });
});

describe('comments', () => {
  const ascii = { style: 'paren', asciiOnly: true, maxLength: 120 } as const;

  it('transliterates Turkish letters', () => {
    expect(transliterateTurkish('şŞğĞıİöÖüÜçÇ')).toBe('sSgGiIoOuUcC');
    expect(sanitizeComment('Mutfak kapakları – Şeker Ölçü İç', ascii)).toBe(
      'Mutfak kapaklari Seker Olcu Ic',
    );
  });

  it('strips parentheses inside ( ) comments, keeps them for ; comments', () => {
    expect(formatComment('Kapak (sol) ', ascii)).toBe('(Kapak sol)');
    expect(formatComment('Kapak (sol)', { ...ascii, style: 'semicolon' })).toBe('; Kapak (sol)');
  });

  it('removes line breaks and control characters, collapses spaces, cuts to max length', () => {
    expect(sanitizeComment('a\r\nb\tc\u0000d', ascii)).toBe('a b c d');
    expect(sanitizeComment('x'.repeat(300), { ...ascii, maxLength: 20 })).toHaveLength(20);
  });

  it('keeps Turkish letters when not ASCII-only; drops emoji when ASCII-only', () => {
    expect(sanitizeComment('Doğrulama ✓', { ...ascii, asciiOnly: false })).toBe('Doğrulama ✓');
    expect(sanitizeComment('Doğrulama ✓', ascii)).toBe('Dogrulama');
  });

  it('an empty comment writes nothing', () => {
    expect(formatComment('  ()  ', ascii)).toBeNull();
  });

  it('random text never breaks the comment syntax in ASCII mode', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (t) => {
        const c = formatComment(t, ascii);
        if (c === null) return;
        expect(c).toMatch(/^\([\x20-\x27\x2A-\x7E]*\)$/);
      }),
    );
  });
});

describe('file names', () => {
  it('sanitises the stem', () => {
    expect(sanitizeFileStem('Mutfak Kapakları (v2)')).toBe('Mutfak_Kapaklari_v2');
    expect(sanitizeFileStem('***')).toBe('nittcam');
  });

  it('respects the length limit by shortening the stem, never the suffix', () => {
    expect(buildFileName('cabinet-doors', '_S1', 'nc', 12)).toBe('cabine_S1.nc');
    for (let max = 8; max < 40; max++) {
      const n = buildFileName('Çok uzun bir proje adı', '_S12_T3', 'tap', max);
      if (n === null) {
        expect('_S12_T3.tap'.length + 1).toBeGreaterThan(max);
        continue;
      }
      expect(n.length).toBeLessThanOrEqual(max);
      expect(n.endsWith('_S12_T3.tap')).toBe(true);
      expect(n).toMatch(/^[A-Za-z0-9_-]+\.tap$/);
    }
  });
});
