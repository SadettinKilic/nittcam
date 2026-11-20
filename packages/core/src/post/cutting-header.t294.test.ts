import { describe, expect, it } from 'vitest';
import { cuttingHeader } from './generate';

// T294 (CTO #11 E1): the KESİM header names the tab count small parts really get.
const base = {
  tabCount: 1,
  smallTabCount: 2,
  tabWidth: 10,
  tabHeight: 3,
  skin: null,
  leadIn: 'arc' as const,
  direction: 'climb' as const,
};

describe('KESİM header tab count (T294)', () => {
  it('every part with 1 tab: small parts get 2, and the line says so', () => {
    expect(cuttingHeader({ ...base, tabMode: 'all' })).toBe(
      'KESİM: köprü her parçada 1 adet 10.000 x 3.000 mm, küçük parçada 2 adet, giriş yay, yön climb',
    );
  });

  it('small parts only: the count is the one used on small parts', () => {
    expect(cuttingHeader({ ...base, tabMode: 'small' })).toContain(
      'köprü yalnız küçük parçada 2 adet 10.000 x 3.000 mm',
    );
  });

  it('no extra note when the count is already ≥ 2 or a skin holds small parts', () => {
    expect(cuttingHeader({ ...base, tabMode: 'all', tabCount: 4, smallTabCount: 4 })).not.toContain(
      'küçük parçada',
    );
    expect(cuttingHeader({ ...base, tabMode: 'all', skin: 0.5 })).not.toContain('küçük parçada 2');
  });
});
