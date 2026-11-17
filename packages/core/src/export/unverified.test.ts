/**
 * T021: `needsUnverifiedAcceptance` agrees with the generator's rule-10 header line (the UI asks for
 * the acceptance exactly when the file says "DOGRULANMADI, once air cut").
 */
import { describe, expect, it } from 'vitest';
import { golden, postConfig } from '../gcode-check/check.testing';
import type { VerificationState } from '../machine';
import { exportNc, needsUnverifiedAcceptance } from './export';

const STATES: VerificationState[] = ['draft', 'air_cut_approved', 'verified', 'reverify_needed'];

describe('needsUnverifiedAcceptance', () => {
  it.each(['generic', 'mach3'] as const)('%s: equals the header line of the file', (post) => {
    const g = golden(post, 'mixed');
    for (const verification of STATES) {
      for (const example of [false, true]) {
        for (const status of ['unverified', 'verified'] as const) {
          const profile = { ...structuredClone(g.context.profile), example };
          const cfg = { ...postConfig(post), status };
          const pv = { profile, version: 1, verification };
          const r = exportNc(g.project, pv, cfg);
          expect(r.ok).toBe(true);
          const first = r.files[0]?.content.split(/\r?\n/)[0] ?? '';
          const header = /DOGRULANMADI|DOĞRULANMADI/.test(first);
          expect(needsUnverifiedAcceptance(pv, cfg)).toBe(header);
        }
      }
    }
  });

  it('an unknown post status counts as unverified', () => {
    const g = golden('generic', 'mixed');
    const pv = {
      profile: { ...g.context.profile, example: false },
      verification: 'verified' as const,
    };
    expect(needsUnverifiedAcceptance(pv, null)).toBe(true);
    expect(needsUnverifiedAcceptance(pv, {})).toBe(true);
    expect(needsUnverifiedAcceptance(pv, { status: 'verified' })).toBe(false);
  });
});
