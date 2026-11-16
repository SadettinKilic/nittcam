import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  currentVerificationState,
  defaultMachineProfile,
  profileChanges,
  VERIFICATION_STAGES,
  verificationAfterChange,
  type MachineProfile,
  type MaterialParams,
  type Tool,
} from './index';

const base = defaultMachineProfile();
function edit(mutate: (p: MachineProfile) => void): MachineProfile {
  const p = defaultMachineProfile();
  mutate(p);
  return p;
}

describe('profileChanges', () => {
  it('identical profiles: no change', () => {
    expect(profileChanges(base, defaultMachineProfile())).toEqual([]);
  });

  it('name, notes and the example flag are not machine changes', () => {
    const next = edit((p) => {
      p.identity.name = 'Atölye 1';
      p.identity.notes = 'arka duvardaki makine';
      p.example = false;
    });
    expect(profileChanges(base, next)).toEqual([]);
  });

  it('key order and tool order do not count', () => {
    const next = edit((p) => {
      p.tools.reverse();
      p.spindle = {
        warmupSeconds: p.spindle.warmupSeconds,
        maxRpm: p.spindle.maxRpm,
        minRpm: p.spindle.minRpm,
        powerKw: p.spindle.powerKw,
      };
    });
    expect(profileChanges(base, next)).toEqual([]);
  });

  it.each<[string, (p: MachineProfile) => void, string[]]>([
    ['Z zero reference', (p) => (p.zZero.reference = 'table'), ['profile']],
    ['origin corner', (p) => (p.origin.corner = 'backRight'), ['profile']],
    ['controller family', (p) => (p.identity.controller.family = 'Mach3'), ['profile']],
    ['material feed', (p) => ((p.materials[0] as MaterialParams).feed = 5000), ['profile']],
    ['tool diameter', (p) => ((p.tools[0] as Tool).diameter = 6.35), ['tools']],
    ['tool removed', (p) => p.tools.pop(), ['tools']],
    ['post version', (p) => (p.post.version = '1.1'), ['post']],
    ['post id', (p) => (p.post.id = 'mach3'), ['post']],
    [
      'everything',
      (p) => {
        p.safeZ = 25;
        (p.tools[0] as Tool).flutes = 3;
        p.post.version = '2.0';
      },
      ['profile', 'tools', 'post'],
    ],
  ])('%s → %j', (_name, mutate, expected) => {
    expect(profileChanges(base, edit(mutate))).toEqual(expected);
  });
});

describe('verificationAfterChange (§7.3 sürüm bağlama)', () => {
  const changed = edit((p) => ((p.tools[0] as Tool).diameter = 6.35));

  it('a verified machine needs re-verification after a tool change', () => {
    expect(verificationAfterChange({ profile: base, state: 'verified' }, changed)).toEqual({
      state: 'reverify_needed',
      changes: ['tools'],
      reverifyNeeded: true,
    });
  });

  it.each(['air_cut_approved', 'test_cut_approved', 'verified', 'reverify_needed'] as const)(
    '%s + a post version change → reverify_needed',
    (state) => {
      const next = edit((p) => (p.post.version = '1.1'));
      expect(verificationAfterChange({ profile: base, state }, next).state).toBe('reverify_needed');
    },
  );

  it('a draft stays a draft (nothing to re-verify)', () => {
    expect(verificationAfterChange({ profile: base, state: 'draft' }, changed)).toEqual({
      state: 'draft',
      changes: ['tools'],
      reverifyNeeded: false,
    });
  });

  it('a rename keeps the verified state', () => {
    const next = edit((p) => (p.identity.name = 'Yeni ad'));
    expect(verificationAfterChange({ profile: base, state: 'verified' }, next).state).toBe(
      'verified',
    );
  });

  it('property: no change keeps any state; a relevant change never keeps a verified stage', () => {
    const states = fc.constantFrom(...VERIFICATION_STAGES, 'reverify_needed' as const);
    const safeZ = fc.integer({ min: 1, max: 150 });
    fc.assert(
      fc.property(states, safeZ, (state, z) => {
        const next = edit((p) => (p.safeZ = z));
        const r = verificationAfterChange({ profile: base, state }, next);
        if (z === base.safeZ) return r.state === state && !r.reverifyNeeded;
        return state === 'draft' ? r.state === 'draft' : r.state === 'reverify_needed';
      }),
    );
  });
});

describe('currentVerificationState', () => {
  it('no verification record → draft', () => {
    expect(currentVerificationState(base, null)).toBe('draft');
  });

  it('record on the same profile → its stage; on an older profile → reverify_needed', () => {
    expect(currentVerificationState(base, { stage: 'air_cut_approved', profile: base })).toBe(
      'air_cut_approved',
    );
    const next = edit((p) => (p.spindle.warmupSeconds = 10));
    expect(currentVerificationState(next, { stage: 'verified', profile: base })).toBe(
      'reverify_needed',
    );
  });
});
