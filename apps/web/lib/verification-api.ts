/** Shapes of the machine verification routes (T022, D-031), shared by server and client. */
import type {
  ExtendedPartInfo,
  MeasurementIssue,
  MeasurementItem,
  TestCutMeasurements,
  TestCutSuggestion,
  TestPartInfo,
  TestProgramKind,
  TrayMeasurementItem,
  TrayTestInfo,
  UnverifiedReason,
  VerificationStage,
  VerificationState,
} from '@nittcam/core';
import type { ExportFileInfo, ExportPostInfo, ExportViolation } from './exports-api';

/**
 * A downloadable program: the §7.3 air cut / test cut, or the extended field-test part (T191,
 * D-092) as `extAirCut` / `extTestCut`.
 */
export type ProgramKind =
  | TestProgramKind
  | 'extAirCut'
  | 'extTestCut'
  /** T356: the ACM tray (composite family). */
  | 'acmAirCut'
  | 'acmTestCut';

/** T356: the verification families the page offers (aluminium's part comes with MB7). */
export type VerificationPageFamily = 'woodBoard' | 'composite';

/** One generated test program (dry run): files only when every check passed. */
export interface TestProgramPreview {
  kind: ProgramKind;
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
  measurements: Partial<TestCutMeasurements> | Record<string, number> | null;
  inTolerance: boolean | null;
}

/** GET /api/machines/:id/verification */
export interface VerificationOverview {
  machineId: string;
  machineName: string;
  profileVersionId: string;
  version: number;
  /** State in `family` (T356). */
  state: VerificationState;
  /** T356: the family this overview is for, and the state of every family on the page. */
  family: VerificationPageFamily;
  families: Record<VerificationPageFamily, VerificationState>;
  /** T356: the ACM tray test part (composite family only). */
  tray: TrayTestInfo | null;
  example: boolean;
  post: ExportPostInfo | null;
  /** Why the files still say "DOĞRULANMADI, önce air cut" (empty = they do not). */
  unverifiedReasons: UnverifiedReason[];
  /** The test part the programs cut (null when the profile cannot make it). */
  testPart: TestPartInfo | null;
  origin: { corner: string; sheetOffset: { x: number; y: number } };
  /** T309: machine-coordinate (G53) park point of a manual tool change; null when not used. */
  park: { x: number; y: number } | null;
  /** T321: a manual tool changer without a usable park point (the tool stops over the sheet). */
  parkOff: boolean;
  /** T336: vacuum hold-down but the programs write no vacuum code: switch it on by hand. */
  vacuumByHand?: true;
  programs: { airCut: TestProgramPreview; testCut: TestProgramPreview };
  /** T191: the extended field-test part (holes, pocket, groove, arcs, inner contour). */
  extended: {
    info: ExtendedPartInfo | null;
    airCut: TestProgramPreview;
    testCut: TestProgramPreview;
  };
  /** T191: test program downloads, newest first (what went to the machine, and when). */
  downloads: TestDownloadItem[];
  history: VerificationHistoryItem[];
}

/** One recorded test-program download (T191, D-093). */
export interface TestDownloadItem {
  kind: ProgramKind;
  name: string;
  sha256: string;
  /** Profile version the file was generated for. */
  version: number;
  /** ISO 8601. */
  at: string;
}

/** POST /api/machines/:id/verification */
export type VerificationRequest =
  | {
      step: 'airCut';
      /** The profile version the page showed; another latest version → 409. */
      profileVersionId: string;
      /** Every air-cut checklist item ticked. */
      checks: Record<AirCutCheck, boolean>;
      /** T356: the family the step is for; absent = wood board. */
      family?: VerificationPageFamily;
    }
  | {
      step: 'testCut';
      profileVersionId: string;
      family?: VerificationPageFamily;
      /** Board: `TestCutMeasurements`; ACM tray (T356): remaining, outerX, outerY. */
      measurements: Record<string, unknown>;
    };

export const AIR_CUT_CHECKS = ['axes', 'spindle', 'safeZ', 'noContact'] as const;
export type AirCutCheck = (typeof AIR_CUT_CHECKS)[number];

export interface VerificationResponse {
  state: VerificationState;
  stage: VerificationStage;
  /** Test cut only. */
  evaluation?: {
    items: (MeasurementItem | TrayMeasurementItem)[];
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
  | {
      error: 'invalid_measurements';
      issues: (MeasurementIssue | { field: string; code: MeasurementIssue['code'] })[];
    }
  | { error: 'program_failed'; message?: string }
  | { error: 'acceptance_required' }
  | { error: 'server_error' };

/** Download URL of a test program file (`accept=1`: the unverified warning was accepted). */
export function testProgramUrl(machineId: string, kind: ProgramKind, name: string): string {
  return `/api/machines/${encodeURIComponent(machineId)}/verification/${kind}/${encodeURIComponent(name)}`;
}
