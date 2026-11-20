import { writeProjectDxf, type DxfExportKind } from '@nittcam/core';
import { companyScope } from '../../../../../lib/server/company';
import { apiError, sha256Hex } from '../../../../../lib/server/exports';
import { UUID } from '../../../../../lib/server/projects';
import { dxfFileName } from '../../../../../lib/server/dxf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: Readonly<Record<string, DxfExportKind>> = { dizilim: 'layout', parcalar: 'parts' };

/**
 * GET /api/projects/:id/dxf?revision=n&tur=dizilim|parcalar (T175, spec §6.6) → the DXF of the
 * saved revision, regenerated on the server: the layout (sheets side by side) or each part once.
 * Tenant-scoped; a deleted project is 404; a stale revision is 409. Storing it in `exports`
 * comes with the export step (T176).
 */
export async function GET(request: Request, ctx: RouteContext<'/api/projects/[id]/dxf'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const url = new URL(request.url);
  const rev = url.searchParams.get('revision') ?? '';
  const kind = KINDS[url.searchParams.get('tur') ?? 'dizilim'];
  if (!/^[1-9]\d{0,8}$/.test(rev) || !kind) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const project = await scope.projects.get(id);
    if (!project || project.deletedAt !== null) return apiError({ error: 'not_found' }, 404);
    if (project.revision !== Number(rev)) {
      return apiError({ error: 'conflict', currentRevision: project.revision }, 409);
    }
    if (kind === 'layout' && (project.data.layout?.sheets.length ?? 0) === 0) {
      return Response.json({ error: 'no_layout' }, { status: 422 });
    }
    const bytes = Buffer.from(writeProjectDxf(project.data, kind), 'utf8');
    const name = dxfFileName(project.name, project.revision, kind);
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'application/dxf',
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        etag: `"${sha256Hex(bytes)}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
