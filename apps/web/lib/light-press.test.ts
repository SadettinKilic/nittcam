import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { caretIndex } from './light-press';

/** Monospace stand-in: every character is 8 px wide. */
const mono = (s: string) => s.length * 8;

describe('caretIndex (B7 r2: a press on a light row puts the caret where a click would)', () => {
  it('picks the nearest character boundary', () => {
    expect(caretIndex('P150', 0, mono)).toBe(0);
    expect(caretIndex('P150', 3, mono)).toBe(0);
    expect(caretIndex('P150', 5, mono)).toBe(1);
    expect(caretIndex('P150', 17, mono)).toBe(2);
    expect(caretIndex('P150', 31, mono)).toBe(4);
  });

  it('left of the text → 0, right of it → the end, empty text → 0', () => {
    expect(caretIndex('Yan', -20, mono)).toBe(0);
    expect(caretIndex('Yan', 500, mono)).toBe(3);
    expect(caretIndex('', 40, mono)).toBe(0);
  });

  it('works with proportional widths', () => {
    const w: Record<string, number> = { i: 3, W: 12, a: 7 };
    const measure = (s: string) => [...s].reduce((n, c) => n + (w[c] ?? 7), 0);
    // "iWa": boundaries at 0, 3, 15, 22
    expect(caretIndex('iWa', 8, measure)).toBe(1);
    expect(caretIndex('iWa', 10, measure)).toBe(2);
    expect(caretIndex('iWa', 20, measure)).toBe(3);
  });

  it('property: always a valid index, and no boundary is nearer to x', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 30 }),
        fc.double({ min: -50, max: 400, noNaN: true }),
        (text, x) => {
          const i = caretIndex(text, x, mono);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThanOrEqual(text.length);
          if (x > 0)
            for (let j = 0; j <= text.length; j++)
              expect(Math.abs(mono(text.slice(0, i)) - x)).toBeLessThanOrEqual(
                Math.abs(mono(text.slice(0, j)) - x),
              );
        },
      ),
      { numRuns: 200 },
    );
  });
});
