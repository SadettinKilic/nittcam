import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';
import { apiError, handleError, readProfile, toDetail } from '../../../../lib/server/machines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/machines/:id → latest profile version of the machine; `?version=n` → that version
 * (T269: the wizard previews with the version the project is bound to, like the export).
 */
export async function GET(request: Request, ctx: RouteContext<'/api/machines/[id]'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const raw = new URL(request.url).searchParams.get('version');
  const version = raw === null ? null : Number(raw);
  if (version !== null && !(Number.isInteger(version) && version > 0)) {
    return apiError({ error: 'bad_request' }, 400);
  }
  try {
    const scope = await companyScope();
    const machine =
      version === null
        ? await scope.machines.getWithProfile(id)
        : await scope.machines.getProfileVersion(id, { version });
    if (!machine) return apiError({ error: 'not_found' }, 404);
    return NextResponse.json(toDetail(machine));
  } catch (err) {
    return handleError(err);
  }
}

/** PUT /api/machines/:id `{ profile }` → saves a new immutable profile version. */
export async function PUT(request: Request, ctx: RouteContext<'/api/machines/[id]'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const profile = await readProfile(request);
  if (profile === undefined) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    return NextResponse.json(toDetail(await scope.machines.saveProfile(id, profile)));
  } catch (err) {
    return handleError(err);
  }
}
