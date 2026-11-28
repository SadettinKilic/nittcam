import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import tr from '../../messages/tr.json';
import type { SimText } from './model';
import { scopeOf, type Finding } from './violations';

const t = tr.simulation as unknown as SimText;
const base: Finding = { group: 'g', severity: 'error', code: 'X', message: 'x' };
const html = (f: Finding) => {
  const node = scopeOf(t, f);
  return node === null ? null : renderToStaticMarkup(<>{node}</>);
};

describe('scopeOf (T398, CTO #14 P9): no "Tüm program" chip', () => {
  it('the whole program has no scope', () => {
    expect(html(base)).toBeNull();
    expect(html({ ...base, line: 0 })).toBeNull();
  });
  it('a sheet is plain text; file and line are mono', () => {
    expect(html({ ...base, sheet: 1 })).toBe('Plaka 2');
    expect(html({ ...base, sheet: 1, line: 14 })).toBe(
      'Plaka 2 · <span class="font-mono">Satır 14</span>',
    );
    expect(html({ ...base, sheet: 0, file: 'a.tap', line: 3 })).toBe(
      '<span class="font-mono">a.tap · Satır 3</span>',
    );
  });
});
