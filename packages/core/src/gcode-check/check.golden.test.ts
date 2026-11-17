/**
 * Golden programs through the automatic checks (T019): every clean golden file passes with zero
 * violations; every catalogue mutation (at least two per rule) is caught with the right rule id,
 * on every golden fixture of the posts it applies to.
 */
import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode } from './check';
import { golden, GOLDEN_IDS, type PostId } from './check.testing';
import { MUTATIONS } from './mutations.testing';
import { GCODE_CHECK_RULES } from './types';

const POSTS: PostId[] = ['generic', 'mach3'];
const CASES = POSTS.flatMap((p) => GOLDEN_IDS.map((f) => golden(p, f)));

describe('golden files pass every check', () => {
  it.each(CASES.map((g) => [g.post, g.fixture, g] as const))('%s %s', (_p, _f, g) => {
    const r = checkGcode(g.text, g.context);
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
    expect(canDownload(r)).toBe(true);
    expect(r.summary.partsCut).toBe(r.summary.partsExpected);
    expect(r.summary.matchedOperations).toBe(g.toolpath.operations.length);
  });
});

describe('the mutation catalogue', () => {
  it('has at least two mutations per §7.2 rule and per §6.5 check', () => {
    for (const rule of GCODE_CHECK_RULES.filter((r) => r !== 'INPUT')) {
      expect(MUTATIONS.filter((m) => m.rule === rule).length, rule).toBeGreaterThanOrEqual(2);
    }
  });

  const runs = MUTATIONS.flatMap((m) =>
    CASES.filter((g) => m.posts.includes(g.post)).map(
      (g) => [m.id, g.post, g.fixture, m, g] as const,
    ),
  );
  it.each(runs)('%s is caught (%s %s)', (_id, _p, _f, m, g) => {
    const lines = g.text.split('\r\n');
    const mutated = m.apply(lines).join('\r\n');
    expect(mutated).not.toBe(g.text);
    const r = checkGcode(mutated, g.context);
    expect(r.ok).toBe(false);
    expect(canDownload(r)).toBe(false);
    const hit = r.violations.filter((v) => v.rule === m.rule && v.severity === 'error');
    expect(hit.length, JSON.stringify(r.violations, null, 1)).toBeGreaterThan(0);
    if (m.code) {
      expect(
        hit.map((v) => v.code),
        JSON.stringify(r.violations, null, 1),
      ).toContain(m.code);
    }
  });
});

describe('verified profile and post', () => {
  it('no header is required when profile and post are verified', () => {
    const g = golden('generic', 'mixed');
    const ctx = {
      ...g.context,
      verification: 'verified' as const,
      profile: { ...g.context.profile, example: false },
      post: { ...g.context.post, status: 'verified' as const },
    };
    const noHeader = g.text.split('\r\n').slice(1).join('\r\n');
    expect(checkGcode(noHeader, ctx).violations).toEqual([]);
    // still required when only the profile is verified
    expect(
      checkGcode(noHeader, { ...ctx, post: { ...ctx.post, status: 'unverified' } }).violations.map(
        (v) => v.code,
      ),
    ).toEqual(['UNVERIFIED_HEADER_MISSING']);
  });
});
