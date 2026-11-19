import { describe, expect, it } from 'vitest';
import { versionGap } from './profile-version';

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
