/** Helpers of the `/api/projects` route handlers (T023, D-029). */
import { parseCommandLog, type CommandLogEntry } from '@nittcam/core';
import {
  InvalidProject,
  NotFound,
  RevisionConflict,
  type CompanyScope,
  type ProjectRow,
} from '@nittcam/db';
import { NextResponse } from 'next/server';
import type { ProjectApiError, ProjectDetail, ProjectListItem } from '../projects-api';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest project name we store (a name is free text; the list shows it in one line). */
export const MAX_NAME = 120;

export function toDetail(row: ProjectRow): ProjectDetail {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    project: row.data,
  };
}

export function toListItem(
  row: ProjectRow,
  machineNames: ReadonlyMap<string, string>,
): ProjectListItem {
  const p = row.data;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    machine: machineNames.get(p.machine.machineId) ?? null,
    material: p.stock.material,
    thickness: p.stock.thickness,
    sheet: { width: p.stock.sheet.width, height: p.stock.sheet.height },
    pieces: p.parts.reduce((sum, part) => sum + part.qty, 0),
  };
}

/** Machine id → name of the company's machines (for the list's machine column). */
export async function machineNames(scope: CompanyScope): Promise<Map<string, string>> {
  const machines = await scope.machines.listWithProfiles();
  return new Map(machines.map((m) => [m.machine.id, m.profile.identity.name]));
}

export function apiError(body: ProjectApiError, status: number): NextResponse<ProjectApiError> {
  return NextResponse.json(body, { status });
}

/** The JSON body as an object, or undefined. */
export async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** A trimmed, non-empty name of at most `MAX_NAME` characters, or undefined. */
export function readName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = v.trim();
  return name.length > 0 && name.length <= MAX_NAME ? name : undefined;
}

/** The command log of a request (optional field → empty), or an error response. */
export function readCommands(
  v: unknown,
): { ok: true; entries: CommandLogEntry[] } | { ok: false; response: NextResponse } {
  if (v === undefined) return { ok: true, entries: [] };
  const log = parseCommandLog(v);
  if (!log.ok) {
    return {
      ok: false,
      response: apiError({ error: 'invalid_commands', detail: log.detail }, 400),
    };
  }
  return { ok: true, entries: log.entries };
}

/** Maps repository errors to HTTP responses (409 for a stale revision, spec §8.2). */
export function handleError(err: unknown): NextResponse<ProjectApiError> {
  if (err instanceof RevisionConflict) {
    return apiError({ error: 'conflict', currentRevision: err.actualRevision }, 409);
  }
  if (err instanceof InvalidProject) {
    return apiError({ error: 'invalid_project', issues: err.issues }, 400);
  }
  if (err instanceof NotFound) return apiError({ error: 'not_found' }, 404);
  console.error(err);
  return apiError({ error: 'server_error' }, 500);
}
