import { describe, expect, it } from 'vitest';
import { holeSummary, rowOpen } from './collapse';

describe('rowOpen', () => {
  it('opens the newest row and rows with an error by default', () => {
    expect(rowOpen(undefined, 2, 3, false)).toBe(true);
    expect(rowOpen(undefined, 0, 3, false)).toBe(false);
    expect(rowOpen(undefined, 0, 3, true)).toBe(true);
    expect(rowOpen(undefined, 0, 1, false)).toBe(true);
  });

  it('keeps the person’s own toggle', () => {
    expect(rowOpen(false, 2, 3, true)).toBe(false);
    expect(rowOpen(true, 0, 3, false)).toBe(true);
  });
});

describe('holeSummary', () => {
  it('lists diameter, blind depth and tool', () => {
    expect(
      holeSummary({ id: 'h', type: 'pocket', d: 35, depth: 12.5, cx: 0, cy: 0, tool: 2 }),
    ).toEqual(['Ø35', '12,5 mm', 'T2']);
    expect(holeSummary({ id: 'h', type: 'through', d: 5, cx: 0, cy: 0, tool: 3 })).toEqual([
      'Ø5',
      'T3',
    ]);
  });
});
