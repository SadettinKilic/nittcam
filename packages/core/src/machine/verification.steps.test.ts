/** T022: which verification step may be recorded in which state (§7.3 order). */
import { describe, expect, it } from 'vitest';
import { canRecordVerification, testCutStage, type VerificationState } from './verification';

const ALL: VerificationState[] = [
  'draft',
  'air_cut_approved',
  'test_cut_approved',
  'verified',
  'reverify_needed',
];

describe('canRecordVerification', () => {
  it('an air cut starts the flow: draft, again on an approved air cut, after a change', () => {
    expect(ALL.filter((s) => canRecordVerification(s, 'airCut'))).toEqual([
      'draft',
      'air_cut_approved',
      'reverify_needed',
    ]);
  });
  it('no air-cut re-record once the version has a test cut (no silent downgrade, D-031)', () => {
    expect(canRecordVerification('test_cut_approved', 'airCut')).toBe(false);
    expect(canRecordVerification('verified', 'airCut')).toBe(false);
  });
  it('a test cut needs an approved air cut on this profile version', () => {
    expect(ALL.filter((s) => canRecordVerification(s, 'testCut'))).toEqual([
      'air_cut_approved',
      'test_cut_approved',
      'verified',
    ]);
  });
  it('a test cut in tolerance verifies, out of tolerance stays at stage 3', () => {
    expect(testCutStage(true)).toBe('verified');
    expect(testCutStage(false)).toBe('test_cut_approved');
  });
});
