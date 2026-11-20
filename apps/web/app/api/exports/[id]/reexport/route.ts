import { NextResponse } from 'next/server';
import type { ExportResponse } from '../../../../../lib/exports-api';
import { parseLabelQuery } from '../../../../../lib/labels-query';
import { companyScope, companyStorage } from '../../../../../lib/server/company';
import { buildDocument, isDocumentType, storeDocument } from '../../../../../lib/server/documents';
import { readSnapshot } from '../../../../../lib/server/export-snapshot';
import {
  apiError,
  runExportOf,
  toRecord,
  type ExportSource,
} from '../../../../../lib/server/exports';
import { storeNcRun } from '../../../../../lib/server/nc-store';
import { readBody, UUID } from '../../../../../lib/server/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/exports/:id/reexport `{ acceptUnverified? }` (T179, spec §3.4 "yeniden export", §6.6):
 * regenerates an export of the history from the revision it was made from (the project snapshot
 * stored with it, D-066), with the same profile version, type and options. Same input and the same
 * machine verification state → the same bytes → the same record (200); a changed state (it is in
 * the NC header) → a new record (201) marked `stateChanged`, never an overwrite (E6, D-060).
 * NC goes through every check again: 422 with the violations when one fails, 428 when the files
 * are unverified and the acceptance is missing. 410 `snapshot_missing` for an export stored before
 * T179 of a revision that is no longer the current one.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/exports/[id]/reexport'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const body = (await readBody(request)) ?? {};
  const accept = body['acceptUnverified'];
  if (accept !== undefined && typeof accept !== 'boolean') {
    return apiError({ error: 'bad_request' }, 400);
  }
  try {
    const scope = await companyScope();
    const row = await scope.exports.get(id);
    if (!row) return apiError({ error: 'not_found' }, 404);
    const project = await scope.projects.get(row.projectId);
    if (!project || project.deletedAt !== null) return apiError({ error: 'not_found' }, 404);

    const snap = await readSnapshot(companyStorage(scope.companyId), row.id);
    let source: ExportSource;
    let labels: string | undefined;
    if (snap) {
      source = { id: project.id, name: snap.name, revision: snap.revision, data: snap.data };
      labels = snap.labels;
    } else if (project.revision === row.projectRevision && row.postId !== 'etiket') {
      source = project;
    } else {
      return apiError({ error: 'snapshot_missing' }, 410);
    }

    let out: ExportResponse;
    let created: boolean;
    if (row.kind === 'nc') {
      const run = await runExportOf(scope, source, row.machineProfileVersionId);
      if (!run.ok || !run.machine || !run.post) {
        return apiError(
          {
            error: 'export_failed',
            stage: run.stage,
            violations: run.violations.filter((v) => v.severity === 'error'),
          },
          422,
        );
      }
      if (run.needsAcceptance && accept !== true) {
        return apiError({ error: 'acceptance_required' }, 428);
      }
      const saved = await storeNcRun(scope, run);
      created = saved.created;
      out = { ...toRecord(saved.row, saved.profileVersion), created };
    } else {
      const type = row.postId;
      if (!isDocumentType(type)) return apiError({ error: 'bad_request' }, 400);
      const settings =
        type === 'etiket' ? parseLabelQuery(new URLSearchParams(labels ?? '')) : undefined;
      if (settings === null) return apiError({ error: 'snapshot_missing' }, 410);
      const doc = await buildDocument(scope, source, type, settings);
      const stored = await storeDocument(scope, source, type, doc, labels);
      if (stored.kind === 'noMachine') {
        return apiError({ error: 'export_failed', stage: 'profile', violations: [] }, 422);
      }
      created = stored.created;
      out = { ...toRecord(stored.row, stored.profileVersion), created };
    }
    out.stateChanged = out.exportId !== row.id && out.verification !== row.verificationState;
    return NextResponse.json(out, { status: created ? 201 : 200 });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
