import { describe, expect, it } from 'vitest';
import { readTokenColors } from './canvas-theme';

describe('canvas token colours (T110)', () => {
  it('reads every token, trims it and falls back to grey when it is missing', () => {
    const values: Record<string, string> = {
      '--color-part': ' #dce6fe ',
      '--color-sheet': '#f6f8fb',
    };
    const style = { getPropertyValue: (name: string) => values[name] ?? '' };
    expect(
      readTokenColors({ part: '--color-part', sheet: '--color-sheet', gone: '--color-x' }, style),
    ).toEqual({ part: '#dce6fe', sheet: '#f6f8fb', gone: '#888888' });
  });
});
