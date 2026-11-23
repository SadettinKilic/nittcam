import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import { mach3PreCheckItems } from './mach3-precheck';

// T332 rider: the field kit's "Mach3 ön kontrol" block shows only for the mach3 post.

describe('mach3PreCheckItems', () => {
  it('gives the seven checks with their Mach3 menu paths for the mach3 post', () => {
    const items = mach3PreCheckItems('mach3', tr.fieldKit.mach3) ?? [];
    expect(items).toHaveLength(7);
    expect(items[0]).toContain('G04 Dwell');
    expect(items.some((i) => i.includes('500 satır'))).toBe(true);
    expect(items.some((i) => i.includes('M7'))).toBe(true);
    expect(items.some((i) => i.includes('DEVIR'))).toBe(true);
    expect(items.some((i) => i.includes('G53'))).toBe(true);
    expect(items.some((i) => i.includes('Motor Tuning'))).toBe(true);
    expect(items.some((i) => i.includes('Program end or M30'))).toBe(true);
  });

  it('gives nothing for the generic post or without a post', () => {
    expect(mach3PreCheckItems('generic', tr.fieldKit.mach3)).toBeNull();
    expect(mach3PreCheckItems(null, tr.fieldKit.mach3)).toBeNull();
    expect(mach3PreCheckItems(undefined, tr.fieldKit.mach3)).toBeNull();
  });
});
