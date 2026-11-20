import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import {
  apiError,
  fileInfos,
  profileInfo,
  runExport,
  toRecord,
} from '../../../../../lib/server/exports';
import { readBody, UUID } from '../../../../../lib/server/projects';
import type { ExportPreview, ExportResponse } from '../../../../../lib/exports-api';
import { markOffcutsUsed } from '../../../../../lib/server/offcuts';
import { storeNcRun } from '../../../../../lib/server/nc-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readRevision(v: unknown): number | undefined {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && (n as number) >= 1 ? (n as number) : undefined;
}

/**
 * GET /api/projects/:id/export?revision=n[&profileVersionId=…] → the server's dry run of the
 * export of the saved revision (status, violations, files with size and hash, checklist data).
 * Nothing is stored. A revision that is not the current one → 409.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/projects/[id]/export'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const url = new URL(request.url);
  const revision = readRevision(url.searchParams.get('revision'));
  const pvId = url.searchParams.get('profileVersionId') ?? undefined;
  if (revision === undefined || (pvId !== undefined && !UUID.test(pvId))) {
    return apiError({ error: 'bad_request' }, 400);
  }
  try {
    const scope = await companyScope();
    const res = await runExport(scope, id, revision, pvId);
    if (res.kind === 'notFound') return apiError({ error: 'not_found' }, 404);
    if (res.kind === 'conflict') {
      return apiError({ error: 'conflict', currentRevision: res.currentRevision }, 409);
    }
    const run = res.run;
    const body: ExportPreview = {
      ok: run.ok,
      stage: run.stage,
      revision,
      violations: run.violations,
      files: fileInfos(run.files),
      needsAcceptance: run.needsAcceptance,
      unverifiedReasons: run.unverifiedReasons,
      profile: profileInfo(run),
      post: run.post,
      checklist: run.checklist,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}

/**
 * POST /api/projects/:id/export `{ revision, profileVersionId?, acceptUnverified? }` (spec §6.6,
 * §7.2 rules 9–10, §8.2): regenerates the NC files from the saved revision, stores them and the
 * export record. 409 for a stale revision; 422 with the violations when a stage or check failed
 * (nothing stored); 428 when the profile is unverified and the acceptance is missing. The same
 * (project, revision, profile version, post, hash) returns the existing export (200, `created:
 * false`); a new one is 201.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/projects/[id]/export'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  const body = await readBody(request);
  const revision = readRevision(body?.['revision']);
  const pvId = body?.['profileVersionId'];
  const accept = body?.['acceptUnverified'];
  if (
    !body ||
    revision === undefined ||
    (pvId !== undefined && (typeof pvId !== 'string' || !UUID.test(pvId))) ||
    (accept !== undefined && typeof accept !== 'boolean')
  ) {
    return apiError({ error: 'bad_request' }, 400);
  }
  try {
    const scope = await companyScope();
    const res = await runExport(scope, id, revision, pvId as string | undefined);
    if (res.kind === 'notFound') return apiError({ error: 'not_found' }, 404);
    if (res.kind === 'conflict') {
      return apiError({ error: 'conflict', currentRevision: res.currentRevision }, 409);
    }
    const run = res.run;
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
    // T168: the offcuts this layout cuts from are consumed by the export.
    await markOffcutsUsed(scope, run.project.data);
    const saved = await storeNcRun(scope, run);
    const out: ExportResponse = {
      ...toRecord(saved.row, saved.profileVersion),
      created: saved.created,
    };
    return NextResponse.json(out, { status: saved.created ? 201 : 200 });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
