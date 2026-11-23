import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NumberInput } from './number-input';

describe('NumberInput unit (B53, "0mm")', () => {
  it('server render reserves the ch estimate plus a gap; the unit span is measured on the client', () => {
    const html = renderToStaticMarkup(
      <NumberInput value={0} onValueChange={() => undefined} unit="mm" />,
    );
    expect(html).toContain('data-unit=""');
    expect(html).toContain('calc(2ch + 0.5rem)');
    expect(html).toMatch(/>mm<\/span>/);
  });

  it('no unit: no reserved room', () => {
    const html = renderToStaticMarkup(<NumberInput value={5} onValueChange={() => undefined} />);
    expect(html).not.toContain('data-unit');
    expect(html).toContain('calc(0.75rem + 0px + 0px)');
  });
});
