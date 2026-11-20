import { describe, expect, it } from 'vitest';
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import { parsePostConfig, type PostConfig } from '../post/config';
import { AUTO_CHANGER_CAPACITY, profileFromPostConfig } from './controller-library';
import { parseMachineProfile } from './profile';

function config(json: unknown): PostConfig {
  const r = parsePostConfig(json);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.config;
}

describe('profileFromPostConfig (T181)', () => {
  for (const [name, json] of [
    ['generic', genericPost],
    ['mach3', mach3Post],
  ] as const) {
    it(`${name}: pre-fill matches the post config`, () => {
      const c = config(json);
      const p = profileFromPostConfig(c);
      expect(parseMachineProfile({ ...p, identity: { ...p.identity, name: 'X' } }).ok).toBe(true);
      expect(p.example).toBe(false);
      expect(p.identity.name).toBe('');
      expect(p.identity.controller.family).toBe(c.name);
      expect(p.post).toEqual({ id: c.id, version: c.version });
      expect(p.toolChanger.type).toBe(c.toolChange.mode);
      expect(p.toolChanger.lengthCompensation).toBe(c.toolChange.lengthOffset);
      expect(p.constraints.maxFileNameLength).toBe(c.file.maxNameLength);
      expect(p.constraints.maxFileSizeMb * 1024 * 1024).toBeCloseTo(c.file.maxSizeBytes, -3);
      expect(p.constraints.arcs).toBe(c.arcs.enabled);
      expect(p.constraints.lineNumbers).toBe(c.lineNumbers.enabled);
      expect(p.constraints.drillCycles).toBe(c.drill.cycles !== 'none');
    });
  }

  it('mach3 gets a manual changer with one position; generic an automatic one', () => {
    expect(profileFromPostConfig(config(mach3Post)).toolChanger).toEqual({
      type: 'manual',
      capacity: 1,
      lengthCompensation: false,
    });
    expect(profileFromPostConfig(config(genericPost)).toolChanger.capacity).toBe(
      AUTO_CHANGER_CAPACITY,
    );
  });
});
