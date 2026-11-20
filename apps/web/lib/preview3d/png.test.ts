import { describe, expect, it } from 'vitest';
import { pngBackground } from './png';

describe('pngBackground (T160)', () => {
  it('uses the theme canvas token, white without one', () => {
    expect(pngBackground({ getPropertyValue: () => ' #0b0d10 ' })).toBe('#0b0d10');
    expect(pngBackground({ getPropertyValue: () => '' })).toBe('#ffffff');
  });
});
