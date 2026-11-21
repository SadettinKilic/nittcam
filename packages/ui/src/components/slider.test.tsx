import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Slider } from './slider';

describe('Slider (T307)', () => {
  const props = {
    value: 18000,
    min: 6000,
    max: 24000,
    step: 500,
    pageStep: 1000,
    onValueChange: () => undefined,
    onValueCommit: () => undefined,
    label: 'T2 devri',
    valueText: '18.000 devir/dk',
  };

  it('names the thumb and reads the value as text; marks and band are hidden from AT', () => {
    const html = renderToStaticMarkup(
      <Slider {...props} mark={{ value: 18000, label: 'Önerilen 18.000' }} band={[14400, 21600]} />,
    );
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="T2 devri"');
    expect(html).toContain('aria-valuetext="18.000 devir/dk"');
    expect(html).toContain('aria-valuemin="6000"');
    expect(html).toContain('aria-valuemax="24000"');
    expect(html).toContain('Önerilen 18.000');
    expect(html).toContain('border-accent');
  });

  it('warning tone colours the thumb', () => {
    expect(renderToStaticMarkup(<Slider {...props} tone="warning" />)).toContain('border-warning');
  });
});
