import { describe, expect, it } from 'vitest';
import { tabTextCode } from './tab-text';

describe('tabTextCode (B44, T293 wording)', () => {
  it('a tab above the range reads "çok yüksek"', () => {
    const m = 'The 5 × 17 mm tabs are below the holding size (width ≥ 3 mm, height 1–17 mm).';
    expect(tabTextCode('TABS_TOO_SMALL', m)).toBeNull();
    const high =
      'Part: the 5 × 17.5 mm tabs are too small to hold it (width ≥ 3 mm, height 1–17 mm); it would be cut free.';
    expect(tabTextCode('SMALL_PART_TAB_TOO_SMALL', high)).toBe('SMALL_PART_TAB_TOO_SMALL_HIGH');
  });
  it('a narrow or low tab keeps the code text; other codes are left alone', () => {
    expect(
      tabTextCode(
        'TABS_TOO_SMALL',
        'The 2 × 3 mm tabs are below the holding size (width ≥ 3 mm, height 1–17 mm).',
      ),
    ).toBeNull();
    expect(tabTextCode('TABS_REDUCED', 'x')).toBeNull();
  });
});
