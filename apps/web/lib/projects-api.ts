/** Shapes of the `/api/projects` route handlers, shared by server and client (T023, D-029). */
import type { CommandLogEntry, Project } from '@nittcam/core';
import type { ExportRecord } from './exports-api';

export type ProjectStatus = 'draft' | 'produced' | 'completed';

export interface ProjectListItem {
  id: string;
  name: string;
  status: ProjectStatus;
  revision: number;
  /** ISO 8601 (UTC). */
  updatedAt: string;
  /** Name of the selected machine, or null when the machine is unknown to the company. */
  machine: string | null;
  material: string;
  thickness: number;
  sheet: { width: number; height: number };
  /** Total part count (sum of quantities). */
  pieces: number;
  /** The newest NC export of the project (T021), or null. */
  lastExport: ExportRecord | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  status: ProjectStatus;
  revision: number;
  updatedAt: string;
  project: Project;
}

/**
 * Log entries the client sends: core commands plus the history events `undo` and `redo`
 * (params `{}`), so the stored log replays to the saved project (D-029).
 */
export type LogEntry = CommandLogEntry;

/** POST /api/projects */
export interface CreateRequest {
  /** Client-generated UUID (D-030): a repeated create with the same id returns the stored project. */
  id?: string;
  name: string;
  project: Project;
  commands?: LogEntry[];
}

/** PUT /api/projects/:id (spec §8.2: single source, revision lock). */
export interface SaveRequest {
  project: Project;
  /** The revision the client's project is based on. */
  baseRevision: number;
  /** Commands since `baseRevision`, oldest first. */
  commands: LogEntry[];
  name?: string;
}

export interface SaveResponse {
  id: string;
  revision: number;
  updatedAt: string;
}

/** POST /api/projects/:id/copy */
export interface CopyRequest {
  name: string;
  /** Copy this project JSON instead of the stored one ("keep mine as a copy" after a conflict). */
  project?: Project;
}

export type ProjectApiError =
  | { error: 'conflict'; currentRevision: number }
  | { error: 'invalid_project'; issues: { path: string; message: string }[] }
  | { error: 'invalid_commands'; detail: string }
  | { error: 'not_found' }
  | { error: 'id_taken' }
  | { error: 'bad_request' }
  | { error: 'server_error' };
