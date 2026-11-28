import { canDownload } from '@nittcam/core';
import { companyScope } from '../../../../../../../lib/server/company';
import { fileBytes, sha256Hex } from '../../../../../../../lib/server/exports';
import { UUID } from '../../../../../../../lib/server/projects';
import {
  apiError,
  familyOfKind,
  isProgramKind,
  loadMachine,
  programAllowed,
  runAnyProgram,
} from '../../../../../../../lib/server/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/machines/:id/verification/:kind/:name?accept=1 → one file of the air-cut (`airCut`) or
 * test-cut (`testCut`) program (or the extended field-test part: `extAirCut` / `extTestCut`, T191), regenerated for the machine's latest profile version and served
 * only when every automatic check passed (§7.2 rule 9). While the file carries "DOĞRULANMADI, önce
 * air cut" the download needs `accept=1` (rule 10). The test cut needs an approved air cut on this
 * profile version (§7.3 order). Every served file is recorded on the machine (T191, D-093).
 */
export async function GET(
  request: Request,
  ctx: RouteContext<'/api/machines/[id]/verification/[kind]/[name]'>,
) {
  const { id, kind, name } = await ctx.params;
  if (!UUID.test(id) || !isProgramKind(kind)) return apiError({ error: 'not_found' }, 404);
  try {
    const scope = await companyScope();
    // T356: the ACM tray programs run with the machine's composite family state.
    const m = await loadMachine(scope, id, familyOfKind(kind));
    if (!m) return apiError({ error: 'not_found' }, 404);
    if (!programAllowed(m, kind)) {
      return apiError({ error: 'not_allowed', state: m.machine.state }, 409);
    }
    const r = runAnyProgram(m, kind);
    if (!r.ok || !r.check || !canDownload(r.check)) {
      return apiError({ error: 'program_failed' }, 422);
    }
    const file = r.files.find((f) => f.name === name);
    if (!file) return apiError({ error: 'not_found' }, 404);
    const first = file.content.split(/\r?\n/)[0] ?? '';
    const unverified = /DOGRULANMADI|DOĞRULANMADI/.test(first);
    if (unverified && new URL(request.url).searchParams.get('accept') !== '1') {
      return apiError({ error: 'acceptance_required' }, 428);
    }
    const bytes = fileBytes(file);
    const sha256 = sha256Hex(bytes);
    // T191 (D-093): what went to the machine is kept on the machine (Saha kiti, history).
    await scope.machines.recordTestDownload(id, {
      kind,
      name: file.name,
      sha256,
      version: m.machine.version.version,
      at: new Date().toISOString(),
    });
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename="${file.name}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        etag: `"${sha256}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
