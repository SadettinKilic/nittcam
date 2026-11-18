import { describe, expect, it } from 'vitest';
import {
  LINE_HEIGHT,
  MONO_ADVANCE,
  formatMm,
  partLabel,
  scaleBar,
  sizeText,
} from './canvas-labels';

describe('formatMm / sizeText', () => {
  it('uses Turkish digits', () => {
    expect(formatMm(2800)).toBe('2.800');
    expect(formatMm(12.5)).toBe('12,5');
    expect(sizeText(600, 400)).toBe('600 × 400');
  });
});

describe('partLabel (T196 fallback rule)', () => {
  const part = { number: '3.1', name: 'Yan panel', w: 600, h: 400 };

  it('shows number + name and W × H when the part is large on screen', () => {
    const l = partLabel({ ...part, scale: 0.5 }); // 300 × 200 px
    expect(l.level).toBe('full');
    expect(l.lines).toEqual(['3.1 Yan panel', '600 × 400']);
  });

  it('falls back to the number, then to nothing, as the zoom drops', () => {
    expect(partLabel({ ...part, scale: 0.1 }).level).toBe('number'); // 60 × 40 px
    expect(partLabel({ ...part, scale: 0.02 }).level).toBe('none'); // 12 × 8 px
  });

  it('truncates a long name with an ellipsis instead of overflowing', () => {
    const l = partLabel({ ...part, name: 'Çok uzun bir parça adı ki sığmaz', scale: 0.3 });
    expect(l.level).toBe('full');
    expect(l.lines[0]?.endsWith('…')).toBe(true);
  });

  it('never overflows the part (grid of sizes, zooms and names)', () => {
    const names = ['', 'A', 'Yan panel', 'Çok uzun bir parça adı ki hiç sığmaz İŞĞ'];
    for (const w of [5, 18, 60, 240, 900, 3000])
      for (const h of [5, 18, 60, 240, 900, 3000])
        for (const scale of [0.01, 0.05, 0.13, 0.4, 1, 4])
          for (const name of names) {
            const l = partLabel({ number: '12.3', name, w, h, scale });
            const fontPx = l.font * scale;
            for (const line of l.lines) {
              expect(line.length * fontPx * MONO_ADVANCE).toBeLessThanOrEqual(w * scale + 1e-6);
            }
            expect(l.lines.length * fontPx * LINE_HEIGHT).toBeLessThanOrEqual(h * scale + 1e-6);
          }
  });
});

describe('scaleBar', () => {
  it('picks a 1/2/5 × 10ⁿ length near the target width', () => {
    const b = scaleBar(0.3);
    expect([100, 200, 500]).toContain(b.mm);
    expect(b.px).toBeGreaterThan(40);
    expect(b.px).toBeLessThan(200);
    expect(scaleBar(0.05).text).toBe('2.000 mm');
  });
});
