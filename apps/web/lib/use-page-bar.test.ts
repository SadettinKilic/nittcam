import { describe, expect, it } from 'vitest';
import { pageBarClearance } from './use-page-bar';

describe('page bar clearance (B49)', () => {
  it('keeps toasts 8 px above a sticky bar, rounded up to whole pixels', () => {
    expect(pageBarClearance(64, 16)).toBe('88px');
    expect(pageBarClearance(63.2, 16)).toBe('88px');
    expect(pageBarClearance(0, 0)).toBe('8px');
  });
});
