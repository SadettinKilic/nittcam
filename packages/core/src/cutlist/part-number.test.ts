import { describe, expect, it } from 'vitest';
import { partNumber, placementNumber } from './part-number';

describe('partNumber (T171)', () => {
  it('is row.copy from 1', () => {
    expect(partNumber(3, 2)).toBe('3.2');
  });
  it('numbers a placement by its cut-list row and copy', () => {
    const project = { parts: [{ id: 'a' }, { id: 'b' }] } as never;
    expect(placementNumber(project, { partId: 'b', index: 0 })).toBe('2.1');
    expect(placementNumber(project, { partId: 'x', index: 0 })).toBeNull();
  });
});
