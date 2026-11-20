import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';
import {
  apiError,
  handleError,
  readBody,
  readCommands,
  readName,
  toDetail,
  UUID,
} from '../../../../lib/server/projects';
import type { SaveResponse } from '../../../../lib/projects-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/projects/:id → the stored project with its revision. */
export async function GET(_request: Request, ctx: RouteContext<'/api/projects/[id]'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  try {
    const scope = await companyScope();
    const row = await scope.projects.get(id);
    if (!row) return apiError({ error: 'not_found' }, 404);
    // A deleted project's direct link opens nothing (T178): 410 with the name for "Geri yükle".
    if (row.deletedAt !== null) return apiError({ error: 'deleted', name: row.name }, 410);
    const exports = await scope.exports.listForProject(id);
    // T303: the newest NC file's revision, so the status card can say the project changed since.
    const nc = exports.filter((e) => e.kind === 'nc').map((e) => e.projectRevision);
    return NextResponse.json({
      ...toDetail(row),
      exported: exports.length > 0,
      lastNcRevision: nc.length > 0 ? Math.max(...nc) : null,
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * PUT /api/projects/:id `{ project, baseRevision, commands, name? }` → saves with the revision lock
 * (spec §8.2): the stored revision must equal `baseRevision`, else 409 `{ error: 'conflict' }`.
 * The commands are appended to `project_commands` under the new revision.
 */
export async function PUT(request: Request, ctx: RouteContext<'/api/projects/[id]'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const body = await readBody(request);
  const base = body?.['baseRevision'];
  if (!body || body['project'] === undefined || !Number.isInteger(base) || (base as number) < 1) {
    return apiError({ error: 'bad_request' }, 400);
  }
  const name = body['name'] === undefined ? undefined : readName(body['name']);
  if (body['name'] !== undefined && name === undefined)
    return apiError({ error: 'bad_request' }, 400);
  const commands = readCommands(body['commands']);
  if (!commands.ok) return commands.response;
  try {
    const scope = await companyScope();
    const current = await scope.projects.get(id);
    if (current?.deletedAt) return apiError({ error: 'deleted', name: current.name }, 410);
    const row = await scope.projects.save(id, {
      revision: base as number,
      data: body['project'],
      commands: commands.entries,
      ...(name !== undefined ? { name } : {}),
    });
    const res: SaveResponse = {
      id: row.id,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    };
    return NextResponse.json(res);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * PATCH /api/projects/:id `{ deleted: boolean }` → soft deletes or restores the project (T178).
 * A deleted project leaves Projeler and Ana sayfa; its data, history and exports are kept, so the
 * "Geri al" toast (or a later restore) brings it back. Company-scoped: another company's id is 404.
 *
 * PATCH `{ status: 'completed' | 'produced' }` (T179, spec §3.4): the manual step of the status
 * flow. "taslak → üretildi" happens only through a stored NC export, so only üretildi ↔
 * tamamlandı is allowed here (409 `bad_status` otherwise). The revision does not change.
 */
export async function PATCH(request: Request, ctx: RouteContext<'/api/projects/[id]'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const body = await readBody(request);
  const deleted = body?.['deleted'];
  const status = body?.['status'];
  const manual = status === 'completed' || status === 'produced';
  if (typeof deleted === 'boolean' ? status !== undefined : !manual) {
    return apiError({ error: 'bad_request' }, 400);
  }
  try {
    const scope = await companyScope();
    if (typeof deleted === 'boolean') {
      const row = await scope.projects.setDeleted(id, deleted);
      if (!row) return apiError({ error: 'not_found' }, 404);
      return NextResponse.json({ id: row.id, deleted: row.deletedAt !== null });
    }
    const current = await scope.projects.get(id);
    if (!current || current.deletedAt !== null) return apiError({ error: 'not_found' }, 404);
    if (current.status === 'draft') return apiError({ error: 'bad_status' }, 409);
    const row = await scope.projects.setStatus(id, status as 'completed' | 'produced');
    if (!row) return apiError({ error: 'not_found' }, 404);
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (err) {
    return handleError(err);
  }
}
