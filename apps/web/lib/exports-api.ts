/** Shapes of the NC export routes (T021, D-030), shared by server and client. */
import type { OriginCorner, UnverifiedReason, VerificationState } from '@nittcam/core';

/** Where the export stopped: the machine profile lookup, then `exportNc`'s stages. */
export type ExportStage = 'profile' | 'toolpath' | 'post' | 'check' | 'done';

/** One problem of an export, with its Turkish text (the UI shows `message` as is). */
export interface ExportViolation {
  stage: ExportStage;
  /** §7.2 rule (`R1`–`R10`) or check group (`MODEL`, `LAYOUT`, `TOOLS`, `INPUT`, `TOOLPATH`, `POST`). */
  rule: string;
  code: string;
  severity: 'error' | 'warning';
  /** Turkish. */
  message: string;
  file?: string;
  /** 1-based G-code line (0 = the whole program). */
  line?: number;
  /** 0-based sheet index. */
  sheet?: number;
}

/** What the pre-export checklist shows (spec §6.5), taken from the profile and the stock. */
export interface ExportChecklistInfo {
  origin: {
    corner: OriginCorner;
    xPositive: 'right' | 'left';
    yPositive: 'back' | 'front';
    sheetOffset: { x: number; y: number };
  };
  zReference: 'table' | 'materialTop';
  /** Tools the program uses (number, diameter mm, type). */
  tools: { number: number; diameter: number; type: string }[];
}

export interface ExportProfileInfo {
  machineId: string;
  machineName: string;
  profileVersionId: string;
  version: number;
  /** Newest version of the machine (the project may be bound to an older one). */
  latestVersion: number;
  verification: VerificationState;
  example: boolean;
}

export interface ExportPostInfo {
  id: string;
  version: string;
  name: string;
}

/** A file before it is stored (preview): name, bytes, sha256 hex. */
export interface ExportFileInfo {
  name: string;
  size: number;
  hash: string;
  sheet: number;
}

/** GET /api/projects/:id/export?revision=n — the server's dry run (nothing is stored). */
export interface ExportPreview {
  ok: boolean;
  stage: ExportStage;
  revision: number;
  violations: ExportViolation[];
  files: ExportFileInfo[];
  /** The files say "DOĞRULANMADI, önce air cut": the download needs the acceptance (§7.2 rule 10). */
  needsAcceptance: boolean;
  /** Why (T022): the profile version is not verified, is the example, or the post is unverified. */
  unverifiedReasons: UnverifiedReason[];
  profile: ExportProfileInfo | null;
  post: ExportPostInfo | null;
  checklist: ExportChecklistInfo | null;
}

/** POST /api/projects/:id/export */
export interface ExportRequest {
  /** The saved revision the user exports; another current revision → 409. */
  revision: number;
  /** A specific profile version of the project's machine (default: the one the project stores). */
  profileVersionId?: string;
  /** The user ticked "Bu makine doğrulanmadı; ilk çalıştırmada air cut yapacağım". */
  acceptUnverified?: boolean;
}

export interface StoredExportFile extends ExportFileInfo {
  downloadUrl: string;
}

/** A stored export (POST result, history row). */
export interface ExportRecord {
  exportId: string;
  projectId: string;
  revision: number;
  /** ISO 8601 (UTC); the date lives here, never in the file (D-025). */
  createdAt: string;
  profileVersionId: string;
  profileVersion: number | null;
  post: { id: string; version: string };
  verification: string;
  unverified: boolean;
  acceptedUnverifiedAt: string | null;
  /** sha256 of the manifest (`<sha256>  <name>` per file). */
  hash: string;
  files: StoredExportFile[];
}

/** POST result: the record, and whether this request created it (false = idempotent repeat). */
export interface ExportResponse extends ExportRecord {
  created: boolean;
}

export type ExportApiError =
  | { error: 'conflict'; currentRevision: number }
  | { error: 'export_failed'; stage: ExportStage; violations: ExportViolation[] }
  | { error: 'acceptance_required' }
  | { error: 'not_found' }
  | { error: 'bad_request' }
  | { error: 'hash_mismatch' }
  | { error: 'file_missing' }
  | { error: 'server_error' };

/** The short form of a hash shown in the UI. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

/** Download URL of one stored file. */
export function downloadUrl(exportId: string, name: string): string {
  return `/api/exports/${encodeURIComponent(exportId)}/files/${encodeURIComponent(name)}`;
}
