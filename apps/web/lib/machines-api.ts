/** Shapes of the `/api/machines` route handlers, shared by server and client (D-016). */
import type { MachineProfile, MachineProfileIssue, VerificationState } from '@nittcam/core';

export interface MachineListItem {
  id: string;
  name: string;
  /** Controller family and version, e.g. "Mach3 R3.043". */
  controller: string;
  /** Latest profile version number. */
  version: number;
  state: VerificationState;
  example: boolean;
  table: { width: number; depth: number };
}

export interface MachineDetail {
  id: string;
  version: number;
  state: VerificationState;
  profile: MachineProfile;
}

export type ApiError =
  | { error: 'invalid_profile'; issues: MachineProfileIssue[] }
  | { error: 'not_found' }
  | { error: 'bad_request' }
  | { error: 'server_error' };
