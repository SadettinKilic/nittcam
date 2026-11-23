import { describe, expect, it } from 'vitest';
import { profileChanges, versionGap } from './profile-version';

describe('versionGap (T269)', () => {
  const pinned = { machineId: 'm1', profileVersion: 1 };
  it('newer latest version of the same machine → its number', () => {
    expect(versionGap(pinned, { id: 'm1', version: 4 })).toBe(4);
  });
  it('same version, other machine or not loaded → null', () => {
    expect(versionGap(pinned, { id: 'm1', version: 1 })).toBeNull();
    expect(versionGap(pinned, { id: 'm2', version: 4 })).toBeNull();
    expect(versionGap(pinned, null)).toBeNull();
  });
});

describe('profileChanges (T332)', () => {
  it('names the groups that differ, in order; identity does not count', () => {
    const a = {
      identity: { name: 'A' },
      tools: [{ number: 2, fluteLength: 25 }],
      post: { id: 'mach3' },
      origin: { corner: 'frontLeft' },
      rapidFeed: 10000,
    };
    expect(profileChanges(a, { ...a, identity: { name: 'B' } })).toEqual([]);
    expect(
      profileChanges(a, { ...a, tools: [{ number: 2, fluteLength: 10 }], rapidFeed: 8000 }),
    ).toEqual(['tools', 'limits']);
    expect(profileChanges(a, { ...a, post: { id: 'generic' }, maxFeed: 6000 })).toEqual([
      'limits',
      'post',
    ]);
  });
});
