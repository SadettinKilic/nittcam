import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';
import { isUuid, offcutError, readStatus, toOffcutItem } from '../../../../lib/server/offcuts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/offcuts/:id `{ status }` → changes the status (e.g. back to available, T168). */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return offcutError({ error: 'not_found' }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return offcutError({ error: 'bad_request' }, 400);
  }
  const status = readStatus(body);
  if (!status) return offcutError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const row = await scope.offcuts.update(id, { status });
    if (!row) return offcutError({ error: 'not_found' }, 404);
    return NextResponse.json(toOffcutItem(row));
  } catch (err) {
    console.error(err);
    return offcutError({ error: 'server_error' }, 500);
  }
}
