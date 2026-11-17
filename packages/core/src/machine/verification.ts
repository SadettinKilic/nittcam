/**
 * Verification binding (spec §7.3 "Sürüm bağlama"; D-016). A verification belongs to one machine
 * profile, one tool set and one post version. When any of them changes, an earlier verification
 * no longer holds and the state becomes "re-verification needed". Pure.
 */
import type { MachineProfile } from './profile';

/** §7.3 stages in order, plus the derived "yeniden doğrulama gerekli". */
export const VERIFICATION_STAGES = [
  'draft',
  'air_cut_approved',
  'test_cut_approved',
  'verified',
] as const;
export type VerificationStage = (typeof VERIFICATION_STAGES)[number];
export type VerificationState = VerificationStage | 'reverify_needed';

/** What changed between two profile versions, as §7.3 groups it. */
export type ProfileChange = 'profile' | 'tools' | 'post';

/** JSON with object keys sorted, so key order never counts as a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return v;
  });
}

/**
 * Machine-relevant part of the profile without tools and post. The display name, notes and the
 * example flag do not change what the machine does, so editing them keeps a verification (D-016).
 */
function machinePart(p: MachineProfile): unknown {
  // Copy and drop the excluded keys, so a field added later is compared by default (safe side).
  const identity: Record<string, unknown> = { ...p.identity };
  delete identity.name;
  delete identity.notes;
  const rest: Record<string, unknown> = { ...p, identity };
  delete rest.tools;
  delete rest.post;
  delete rest.example;
  return rest;
}

/** The tool set, order-independent (sorted by tool number). */
function toolSet(p: MachineProfile): unknown {
  return [...p.tools].sort((a, b) => a.number - b.number);
}

/** Which §7.3 groups differ between `prev` and `next` (empty when nothing relevant changed). */
export function profileChanges(prev: MachineProfile, next: MachineProfile): ProfileChange[] {
  const changes: ProfileChange[] = [];
  if (canonical(machinePart(prev)) !== canonical(machinePart(next))) changes.push('profile');
  if (canonical(toolSet(prev)) !== canonical(toolSet(next))) changes.push('tools');
  if (prev.post.id !== next.post.id || prev.post.version !== next.post.version)
    changes.push('post');
  return changes;
}

export interface VerifiedProfile {
  profile: MachineProfile;
  /** State the machine had with `profile`. */
  state: VerificationState;
}

export interface VerificationAfterChange {
  state: VerificationState;
  changes: ProfileChange[];
  /** True when an earlier verification stage was lost by this change. */
  reverifyNeeded: boolean;
}

/**
 * State of a machine after its profile goes from `prev.profile` to `next` (§7.3):
 * - nothing relevant changed → the state is kept;
 * - a draft (never verified) stays a draft;
 * - any verified stage (or an already pending re-verification) → `reverify_needed`.
 */
export function verificationAfterChange(
  prev: VerifiedProfile,
  next: MachineProfile,
): VerificationAfterChange {
  const changes = profileChanges(prev.profile, next);
  if (changes.length === 0 || prev.state === 'draft') {
    return { state: prev.state, changes, reverifyNeeded: false };
  }
  return { state: 'reverify_needed', changes, reverifyNeeded: true };
}

/**
 * Current state of a machine from its latest profile and the latest recorded verification
 * (the stage plus the profile version it was recorded against). No record → `draft`.
 */
export function currentVerificationState(
  current: MachineProfile,
  lastVerification: { stage: VerificationStage; profile: MachineProfile } | null,
): VerificationState {
  if (!lastVerification) return 'draft';
  return verificationAfterChange(
    { profile: lastVerification.profile, state: lastVerification.stage },
    current,
  ).state;
}

/** What the user records in the verification flow (T022, D-031). */
export type VerificationStep = 'airCut' | 'testCut';

/**
 * May `step` be recorded for a profile version in `state` (§7.3 order: draft → air cut approved →
 * test cut approved → verified)? An air cut may always be (re)approved: it starts the flow, and
 * after a change (`reverify_needed`) the flow starts again from it. The test cut needs an approved
 * air cut on this very profile version (or a later stage, to measure again).
 */
export function canRecordVerification(state: VerificationState, step: VerificationStep): boolean {
  if (step === 'airCut') return true;
  return state === 'air_cut_approved' || state === 'test_cut_approved' || state === 'verified';
}

/** Stage a recorded test cut gives: measured and in tolerance → verified (§7.3 stages 3 and 4). */
export function testCutStage(inTolerance: boolean): VerificationStage {
  return inTolerance ? 'verified' : 'test_cut_approved';
}
