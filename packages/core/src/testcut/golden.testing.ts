/**
 * Golden test programs (T022, D-031): the air-cut and test-cut programs of each shipped post on
 * the golden profile (`goldenProfile`, state draft), compared byte for byte with
 * `packages/machines/<post>/v1/golden/{AIRCUT,TESTPARCA}_S1.*`. Shared by the test and the
 * `golden:update` script. Not exported from the package.
 */
import { GOLDEN_POSTS, goldenProfile } from '../post/golden.testing';
import { testProgram, type TestProgramKind, type TestProgramResult } from './program';

export interface TestProgramGoldenCase {
  postId: 'generic' | 'mach3';
  dir: string;
  kind: TestProgramKind;
  result: TestProgramResult;
}

export const TEST_PROGRAM_KINDS: readonly TestProgramKind[] = ['airCut', 'testCut'];

/** File-name prefix of each program kind (the post adds `_S1.<ext>`). */
export const TEST_PROGRAM_PREFIX: Record<TestProgramKind, string> = {
  airCut: 'AIRCUT_',
  testCut: 'TESTPARCA_',
};

export function testProgramCases(): TestProgramGoldenCase[] {
  const out: TestProgramGoldenCase[] = [];
  for (const post of GOLDEN_POSTS) {
    const profile = goldenProfile(post.id);
    for (const kind of TEST_PROGRAM_KINDS) {
      const result = testProgram(kind, { profile, version: 1, verification: 'draft' }, post.config);
      out.push({ postId: post.id, dir: post.dir, kind, result });
    }
  }
  return out;
}
