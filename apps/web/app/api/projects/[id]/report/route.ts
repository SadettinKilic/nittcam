import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import { apiError } from '../../../../../lib/server/exports';
import { UUID } from '../../../../../lib/server/projects';
import { reportSummary } from '../../../../../lib/server/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/:id/report?revision=n (T177, spec §6.6) → the report summary of the saved
 * revision (waste %, waste and part area, sheets, estimated cut time, pieces), the same values the
 * PDF report prints. Tenant-scoped; a deleted project is 404; a stale revision is 409.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/projects/[id]/report'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const rev = new URL(request.url).searchParams.get('revision') ?? '';
  if (!/^[1-9]\d{0,8}$/.test(rev)) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const project = await scope.projects.get(id);
    if (!project || project.deletedAt !== null) return apiError({ error: 'not_found' }, 404);
    if (project.revision !== Number(rev)) {
      return apiError({ error: 'conflict', currentRevision: project.revision }, 409);
    }
    return NextResponse.json(await reportSummary(scope, project), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
