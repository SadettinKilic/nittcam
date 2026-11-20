/** Shapes of the `/api/machines` route handlers, shared by server and client (D-016). */
import type {
  MachineProfile,
  MachineProfileIssue,
  MaintenanceEntry,
  VerificationState,
} from '@nittcam/core';

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
  /** Archived (T289): hidden from new projects and Ana sayfa counts; old projects still use it. */
  archived: boolean;
  /** Newest manual maintenance entry (T181); null = none recorded. */
  maintenance: MaintenanceEntry | null;
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

/**
 * Machines a project may pick (T289): the active ones, plus the machine the project is already
 * bound to even when it was archived later (the old project keeps opening on it).
 */
export function pickableMachines(
  machines: readonly MachineListItem[],
  currentId: string | null = null,
): MachineListItem[] {
  return machines.filter((m) => !m.archived || m.id === currentId);
}
