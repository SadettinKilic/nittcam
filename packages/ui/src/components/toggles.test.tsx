import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiteCheckbox } from './toggles';

describe('LiteCheckbox', () => {
  it('is a plain checkbox button with the checked state for AT and styles', () => {
    const on = renderToStaticMarkup(<LiteCheckbox checked aria-label="Satır 1: seç" />);
    expect(on).toMatch(/^<button type="button" role="checkbox" aria-checked="true"/);
    expect(on).toContain('data-state="checked"');
    expect(on).toContain('<svg');
    const off = renderToStaticMarkup(<LiteCheckbox checked={false} aria-label="x" />);
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('data-state="unchecked"');
    expect(off).not.toContain('<svg');
  });
});
