import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseNumberTr } from '../lib/number';
import { Measure, formatMeasure } from './measure';

describe('formatMeasure', () => {
  it('formats the Turkish way', () => {
    expect(formatMeasure(1220.5)).toBe('1.220,5');
    expect(formatMeasure(2440)).toBe('2.440');
    expect(formatMeasure(18, { decimals: 1 })).toBe('18,0');
    expect(formatMeasure(0.125, { maxDecimals: 3 })).toBe('0,125');
    expect(formatMeasure(12000, { decimals: 0 })).toBe('12.000');
    expect(formatMeasure(Number.NaN)).toBe('');
  });

  it('round-trips through parseNumberTr', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e7, max: 1e7 }), (n) => {
        const v = n / 10;
        const parsed = parseNumberTr(formatMeasure(v));
        expect(parsed.ok && parsed.value).toBe(v);
      }),
    );
  });
});

describe('Measure', () => {
  it('renders value and muted unit with tabular figures', () => {
    const html = renderToStaticMarkup(<Measure value={1220} unit="mm" />);
    expect(html).toContain('numeric');
    expect(html).toContain('1.220 <span class="font-normal text-fg-muted">mm</span>');
    expect(html).not.toContain('font-mono');
  });

  it('joins several values with ×, mono on request', () => {
    const html = renderToStaticMarkup(<Measure value={[3050, 2150]} unit="mm" mono />);
    expect(html).toContain('3.050 × 2.150');
    expect(html).toContain('font-mono');
  });

  it('shows the empty text without a unit for missing values', () => {
    const html = renderToStaticMarkup(<Measure value={Number.NaN} unit="mm" />);
    expect(html).toContain('—');
    expect(html).not.toContain('mm');
  });
});
