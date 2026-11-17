import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import {
  apiError,
  handleError,
  readBody,
  readName,
  toDetail,
  UUID,
} from '../../../../../lib/server/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/:id/copy `{ name, project? }` → a new project (revision 1, taslak) with the
 * stored project JSON, or with `project` when given ("keep mine as a copy" after a conflict).
 * The command history stays with the original (201, the new project's detail).
 */
export async function POST(request: Request, ctx: RouteContext<'/api/projects/[id]/copy'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const body = await readBody(request);
  const name = readName(body?.['name']);
  if (!body || !name) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const source = await scope.projects.get(id);
    if (!source) return apiError({ error: 'not_found' }, 404);
    const row = await scope.projects.create({ name, data: body['project'] ?? source.data });
    return NextResponse.json(toDetail(row), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
