import { describe, expect, it } from 'vitest';
import { suggestedLayerOp } from './layers';

describe('suggestedLayerOp (B70 rider)', () => {
  it('fold-line layer names suggest V-kanal on a folding stock, any case or diacritics', () => {
    for (const name of [
      'V-kanal',
      'VKANAL',
      'v_groove',
      'V GROOVE',
      'Büküm',
      'BÜKÜM',
      'bukum',
      ' V-Kanal ',
    ])
      expect(suggestedLayerOp(name, true)).toBe('vgroove');
  });
  it('other names and non-folding stock suggest nothing', () => {
    for (const name of ['KANAL', 'PART', 'V', 'VKANAL2', 'Delik'])
      expect(suggestedLayerOp(name, true)).toBeUndefined();
    expect(suggestedLayerOp('V-kanal', false)).toBeUndefined();
  });
});
