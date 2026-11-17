import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import { apiError, toRecord, versionNumbers } from '../../../../../lib/server/exports';
import { UUID } from '../../../../../lib/server/projects';
import type { ExportRecord } from '../../../../../lib/exports-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/projects/:id/exports → the project's export history, newest first (D-030). */
export async function GET(_request: Request, ctx: RouteContext<'/api/projects/[id]/exports'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  try {
    const scope = await companyScope();
    if (!(await scope.projects.get(id))) return apiError({ error: 'not_found' }, 404);
    const [rows, versions] = await Promise.all([
      scope.exports.listForProject(id),
      versionNumbers(scope),
    ]);
    const body: ExportRecord[] = rows.map((r) =>
      toRecord(r, versions.get(r.machineProfileVersionId) ?? null),
    );
    return NextResponse.json(body);
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
