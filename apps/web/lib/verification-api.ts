/** Shapes of the machine verification routes (T022, D-031), shared by server and client. */
import type {
  MeasurementIssue,
  MeasurementItem,
  TestCutMeasurements,
  TestCutSuggestion,
  TestPartInfo,
  TestProgramKind,
  UnverifiedReason,
  VerificationStage,
  VerificationState,
} from '@nittcam/core';
import type { ExportFileInfo, ExportPostInfo, ExportViolation } from './exports-api';

/** One generated test program (dry run): files only when every check passed. */
export interface TestProgramPreview {
  kind: TestProgramKind;
  ok: boolean;
  files: (ExportFileInfo & { downloadUrl: string })[];
  violations: ExportViolation[];
  /** False when the current state does not allow this program yet (test cut before air cut). */
  allowed: boolean;
}

export interface VerificationHistoryItem {
  id: string;
  stage: VerificationStage;
  /** Profile version the step was recorded against. */
  version: number;
  /** ISO 8601. */
  createdAt: string;
  /** For test cuts: the measured values and the evaluation at the time. */
  measurements: Partial<TestCutMeasurements> | null;
  inTolerance: boolean | null;
}

/** GET /api/machines/:id/verification */
export interface VerificationOverview {
  machineId: string;
  machineName: string;
  profileVersionId: string;
  version: number;
  state: VerificationState;
  example: boolean;
  post: ExportPostInfo | null;
  /** Why the files still say "DOĞRULANMADI, önce air cut" (empty = they do not). */
  unverifiedReasons: UnverifiedReason[];
  /** The test part the programs cut (null when the profile cannot make it). */
  testPart: TestPartInfo | null;
  origin: { corner: string; sheetOffset: { x: number; y: number } };
  programs: { airCut: TestProgramPreview; testCut: TestProgramPreview };
  history: VerificationHistoryItem[];
}

/** POST /api/machines/:id/verification */
export type VerificationRequest =
  | {
      step: 'airCut';
      /** The profile version the page showed; another latest version → 409. */
      profileVersionId: string;
      /** Every air-cut checklist item ticked. */
      checks: Record<AirCutCheck, boolean>;
    }
  | {
      step: 'testCut';
      profileVersionId: string;
      measurements: Partial<Record<keyof TestCutMeasurements, unknown>>;
    };

export const AIR_CUT_CHECKS = ['axes', 'spindle', 'safeZ', 'noContact'] as const;
export type AirCutCheck = (typeof AIR_CUT_CHECKS)[number];

export interface VerificationResponse {
  state: VerificationState;
  stage: VerificationStage;
  /** Test cut only. */
  evaluation?: {
    items: MeasurementItem[];
    inTolerance: boolean;
    suggestions: TestCutSuggestion[];
  };
}

export type VerificationApiError =
  | { error: 'not_found' }
  | { error: 'bad_request' }
  | { error: 'stale_version'; version: number }
  | { error: 'not_allowed'; state: VerificationState }
  | { error: 'checks_required' }
  | { error: 'invalid_measurements'; issues: MeasurementIssue[] }
  | { error: 'program_failed' }
  | { error: 'acceptance_required' }
  | { error: 'server_error' };

/** Download URL of a test program file (`accept=1`: the unverified warning was accepted). */
export function testProgramUrl(machineId: string, kind: TestProgramKind, name: string): string {
  return `/api/machines/${encodeURIComponent(machineId)}/verification/${kind}/${encodeURIComponent(name)}`;
}
