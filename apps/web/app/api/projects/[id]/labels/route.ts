import { companyScope } from '../../../../../lib/server/company';
import { apiError, sha256Hex } from '../../../../../lib/server/exports';
import { exportFileName } from '../../../../../lib/file-names';
import { renderLabelsPdf } from '../../../../../lib/server/pdf/labels-pdf';
import { UUID } from '../../../../../lib/server/projects';
import { parseLabelQuery } from '../../../../../lib/labels-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/:id/labels?revision=n&preset=a4-3x8|a4-2x7|custom[&cols…gapY][&dx&dy]
 * [&download=1] (T174, spec §2.4, §6.6): the part label sheet of the saved revision, one label per
 * piece. A custom grid must fit on A4; the print offset is ±20 mm. Stale revision → 409.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/projects/[id]/labels'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const url = new URL(request.url);
  const rev = url.searchParams.get('revision') ?? '';
  const revision = /^\d+$/.test(rev) ? Number(rev) : 0;
  const settings = parseLabelQuery(url.searchParams);
  if (revision < 1 || !settings) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const project = await scope.projects.get(id);
    if (!project) return apiError({ error: 'not_found' }, 404);
    if (project.revision !== revision) {
      return apiError({ error: 'conflict', currentRevision: project.revision }, 409);
    }
    const bytes = await renderLabelsPdf({
      project: project.data,
      projectName: project.name,
      revision,
      grid: settings.grid,
      offset: settings.offset,
    });
    const name = exportFileName(project.name, revision, 'etiket', 'pdf');
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${disposition}; filename="${name}"`,
        'cache-control': 'no-store',
        etag: `"${sha256Hex(bytes)}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
