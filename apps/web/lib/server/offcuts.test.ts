import { describe, expect, it } from 'vitest';
import { toOffcutItem } from './offcuts';

const row = {
  id: 'o1',
  material: 'mdf',
  thickness: 18,
  width: 400,
  height: 300,
  grain: null,
  sourceProjectId: 'p1',
  status: 'available' as const,
  createdAt: new Date('2026-11-20T10:00:00Z'),
};

describe('toOffcutItem source name (P4)', () => {
  it('names the source project when the list knows it', () => {
    expect(toOffcutItem(row, new Map([['p1', 'Mutfak']])).sourceProjectName).toBe('Mutfak');
    expect(toOffcutItem(row, new Map()).sourceProjectName).toBeNull();
    expect(
      toOffcutItem({ ...row, sourceProjectId: null }, new Map([['p1', 'x']])).sourceProjectName,
    ).toBeNull();
  });

  it('leaves the field out without names (single-row answers)', () => {
    expect('sourceProjectName' in toOffcutItem(row)).toBe(false);
  });
});
