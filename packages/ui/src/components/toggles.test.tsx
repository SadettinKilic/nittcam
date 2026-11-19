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

  it('Enter does not activate it (a native checkbox toggles on Space only); onKeyDown still runs', () => {
    const seen: string[] = [];
    const el = LiteCheckbox({ checked: false, onKeyDown: (e) => seen.push(e.key) });
    const press = (key: string) => {
      let prevented = false;
      const e = { key, preventDefault: () => (prevented = true) };
      (el.props as { onKeyDown: (e: unknown) => void }).onKeyDown(e);
      return prevented;
    };
    expect(press('Enter')).toBe(true);
    expect(press(' ')).toBe(false);
    expect(seen).toEqual(['Enter', ' ']);
  });
});
