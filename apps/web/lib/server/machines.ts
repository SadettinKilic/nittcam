import type { MachineWithProfile } from '@nittcam/db';
import { InvalidMachineProfile, NotFound } from '@nittcam/db';
import { NextResponse } from 'next/server';
import type { ApiError, MachineDetail, MachineListItem } from '../machines-api';

export function toListItem(m: MachineWithProfile): MachineListItem {
  const { controller } = m.profile.identity;
  return {
    id: m.machine.id,
    name: m.profile.identity.name,
    controller: [controller.family, controller.version].filter((s) => s !== '').join(' '),
    version: m.version.version,
    state: m.state,
    example: m.profile.example,
    table: m.profile.table,
  };
}

export function toDetail(m: MachineWithProfile): MachineDetail {
  return { id: m.machine.id, version: m.version.version, state: m.state, profile: m.profile };
}

export function apiError(body: ApiError, status: number): NextResponse<ApiError> {
  return NextResponse.json(body, { status });
}

/** Reads a JSON body `{ profile }`; `undefined` when the body is not JSON or has no profile. */
export async function readProfile(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && 'profile' in body) return body.profile;
  } catch {
    // fall through
  }
  return undefined;
}

/** Maps repository errors to HTTP responses. */
export function handleError(err: unknown): NextResponse<ApiError> {
  if (err instanceof InvalidMachineProfile) {
    return apiError({ error: 'invalid_profile', issues: err.issues }, 400);
  }
  if (err instanceof NotFound) return apiError({ error: 'not_found' }, 404);
  console.error(err);
  return apiError({ error: 'server_error' }, 500);
}
