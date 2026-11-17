/** Verification state → badge look and stepper progress (spec §7.3; T107, T108). */
import { VERIFICATION_STAGES, type VerificationState } from '@nittcam/core';

export type StateTone = 'neutral' | 'info' | 'accent' | 'success' | 'warning';

/** Badge variant per state: grey draft, blue in progress, green verified, amber re-verify. */
export const STATE_TONE: Record<VerificationState, StateTone> = {
  draft: 'neutral',
  air_cut_approved: 'info',
  test_cut_approved: 'info',
  verified: 'success',
  reverify_needed: 'warning',
};

export type StepStatus = 'done' | 'current' | 'upcoming';

/**
 * Status of each stage of the stepper (Taslak → Air cut → Test kesimi → Doğrulanmış). The stage
 * the machine has reached is done; the next one is current. "Yeniden doğrulama gerekli" restarts at
 * the air cut (D-031), so only the draft stage counts as done. A verified machine has every stage
 * done.
 */
export function stepStatuses(state: VerificationState): StepStatus[] {
  const reached = VERIFICATION_STAGES.indexOf(state === 'reverify_needed' ? 'draft' : state);
  return VERIFICATION_STAGES.map((_, i) =>
    i <= reached ? 'done' : i === reached + 1 ? 'current' : 'upcoming',
  );
}
