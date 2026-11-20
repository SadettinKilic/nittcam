import { InvalidMaintenanceEntry } from '@nittcam/db';
import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import { isRepoError } from '../../../../../lib/server/errors';
import { apiError, handleError } from '../../../../../lib/server/machines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/machines/:id/maintenance → `{ log }`, oldest first (T181). */
export async function GET(_request: Request, ctx: RouteContext<'/api/machines/[id]/maintenance'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  try {
    const log = await (await companyScope()).machines.maintenance(id);
    if (!log) return apiError({ error: 'not_found' }, 404);
    return NextResponse.json({ log });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/machines/:id/maintenance `{ date, intervalDays, note }` → records a maintenance and
 * returns the whole `{ log }` (T181). Bad entry → 400; another company's machine → 404.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/machines/[id]/maintenance'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError({ error: 'bad_request' }, 400);
  }
  try {
    const log = await (await companyScope()).machines.addMaintenance(id, body);
    if (!log) return apiError({ error: 'not_found' }, 404);
    return NextResponse.json({ log });
  } catch (err) {
    if (isRepoError(err, InvalidMaintenanceEntry, 'InvalidMaintenanceEntry')) {
      return apiError({ error: 'bad_request' }, 400);
    }
    return handleError(err);
  }
}
