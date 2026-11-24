import type { PaperSize } from '@nittcam/core';
import { companyScope } from '../../../../../lib/server/company';
import { currentCompanyMark } from '../../../../../lib/server/company-mark';
import { apiError, sha256Hex } from '../../../../../lib/server/exports';
import {
  estimateCutSeconds,
  pdfMachine,
  pdfNc,
  pdfOffcuts,
} from '../../../../../lib/server/pdf/cut-time';
import { exportFileName } from '../../../../../lib/file-names';
import { renderProjectPdf } from '../../../../../lib/server/pdf/project-pdf';
import { UUID } from '../../../../../lib/server/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAPERS: Record<string, PaperSize> = { a4: 'A4', a3: 'A3' };

/**
 * GET /api/projects/:id/pdf?revision=n[&paper=a4|a3][&download=1] (T172, spec §6.6): the project
 * PDF regenerated on the server from the saved revision. A revision that is not the current one →
 * 409. Same project, revision and paper → same bytes (the `ETag` is their sha256).
 */
export async function GET(request: Request, ctx: RouteContext<'/api/projects/[id]/pdf'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const url = new URL(request.url);
  const rev = url.searchParams.get('revision') ?? '';
  const revision = /^\d+$/.test(rev) ? Number(rev) : 0;
  const paper = PAPERS[(url.searchParams.get('paper') ?? 'a4').toLowerCase()];
  if (revision < 1 || !paper) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const project = await scope.projects.get(id);
    if (!project) return apiError({ error: 'not_found' }, 404);
    if (project.revision !== revision) {
      return apiError({ error: 'conflict', currentRevision: project.revision }, 409);
    }
    const bytes = await renderProjectPdf({
      project: project.data,
      projectName: project.name,
      revision,
      paper,
      cutSeconds: await estimateCutSeconds(scope, project),
      company: await currentCompanyMark(scope),
      machine: await pdfMachine(scope, project.data),
      offcuts: await pdfOffcuts(scope, project.data),
      nc: await pdfNc(scope, project),
    });
    const name = exportFileName(project.name, revision, paper.toLowerCase(), 'pdf');
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
