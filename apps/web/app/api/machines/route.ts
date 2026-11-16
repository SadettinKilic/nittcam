import { NextResponse } from 'next/server';
import { companyScope } from '../../../lib/server/company';
import {
  apiError,
  handleError,
  readProfile,
  toDetail,
  toListItem,
} from '../../../lib/server/machines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/machines → machines of the company with their verification state. */
export async function GET() {
  try {
    const scope = await companyScope();
    const machines = await scope.machines.listWithProfiles();
    return NextResponse.json(machines.map(toListItem));
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/machines `{ profile }` → creates the machine with profile version 1 (201). */
export async function POST(request: Request) {
  const profile = await readProfile(request);
  if (profile === undefined) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const created = await scope.machines.createWithProfile(profile);
    return NextResponse.json(toDetail(created), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
