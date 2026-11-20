import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import { apiError, handleError, UUID } from '../../../../../lib/server/projects';
import type { ProjectLinks } from '../../../../../lib/project-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/:id/links → `{ source, derived }` (T292): the project this one was split off
 * from and the projects split off from it; deleted projects are left out. Company-scoped: another
 * company's id is 404.
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/projects/[id]/links'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  try {
    const scope = await companyScope();
    if (!(await scope.projects.get(id))) return apiError({ error: 'not_found' }, 404);
    const links: ProjectLinks = await scope.projects.links(id);
    return NextResponse.json(links);
  } catch (err) {
    return handleError(err);
  }
}
