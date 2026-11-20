import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import { buildDocument, isDocumentType, storeDocument } from '../../../../../lib/server/documents';
import { apiError, toRecord } from '../../../../../lib/server/exports';
import { readBody, UUID } from '../../../../../lib/server/projects';
import { parseLabelQuery } from '../../../../../lib/labels-query';
import type { ExportResponse } from '../../../../../lib/exports-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/:id/documents `{ revision, type, labels? }` (T176, spec §6.6): regenerates one
 * document of the saved revision (`dxf-dizilim`, `dxf-parcalar`, `pdf-a4`, `pdf-a3`, `etiket`; the
 * label sheet takes `labels`, the query string of its settings) and stores it as an export record.
 * 201 new, 200 the same record again; 409 stale revision; 404 unknown or deleted project; 422 no
 * layout or no machine.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/projects/[id]/documents'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const body = await readBody(request);
  const revision = body?.['revision'];
  const type = body?.['type'];
  const rawLabels = body?.['labels'];
  if (!Number.isInteger(revision) || (revision as number) < 1 || !isDocumentType(type)) {
    return apiError({ error: 'bad_request' }, 400);
  }
  const labels =
    type === 'etiket'
      ? typeof rawLabels === 'string'
        ? parseLabelQuery(new URLSearchParams(rawLabels))
        : null
      : undefined;
  if (labels === null) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const project = await scope.projects.get(id);
    if (!project || project.deletedAt !== null) return apiError({ error: 'not_found' }, 404);
    if (project.revision !== revision) {
      return apiError({ error: 'conflict', currentRevision: project.revision }, 409);
    }
    if (project.data.layout.sheets.length === 0 && type !== 'dxf-parcalar') {
      return apiError({ error: 'export_failed', stage: 'profile', violations: [] }, 422);
    }
    const doc = await buildDocument(scope, project, type, labels);
    const stored = await storeDocument(scope, project, type, doc);
    if (stored.kind === 'noMachine') {
      return apiError({ error: 'export_failed', stage: 'profile', violations: [] }, 422);
    }
    const out: ExportResponse = {
      ...toRecord(stored.row, stored.profileVersion),
      created: stored.created,
    };
    return NextResponse.json(out, { status: stored.created ? 201 : 200 });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
