import { companyScope, companyStorage } from '../../../../../../lib/server/company';
import { apiError, sha256Hex } from '../../../../../../lib/server/exports';
import { UUID } from '../../../../../../lib/server/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** File names the post produces (ASCII, D-025); anything else is not ours. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * GET /api/exports/:id/files/:name → the stored bytes of one file of an export, as an attachment
 * with the file's own name (spec §6.6, D-030). Tenant-scoped: another company's export is 404.
 * The stored size and sha256 are checked again before serving; a changed file is refused (409),
 * so only the checked file can reach a machine (§7.2 rule 9). An unverified export without the
 * recorded acceptance is refused (rule 10; the database already forbids such a row).
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/exports/[id]/files/[name]'>) {
  const { id, name } = await ctx.params;
  if (!UUID.test(id) || !NAME.test(name)) return apiError({ error: 'not_found' }, 404);
  try {
    const scope = await companyScope();
    const row = await scope.exports.get(id);
    const file = row?.files.find((f) => f.name === name);
    if (!row || !file) return apiError({ error: 'not_found' }, 404);
    if (row.unverified && row.acceptedUnverifiedAt === null) {
      return apiError({ error: 'acceptance_required' }, 428);
    }
    const bytes = await companyStorage(scope.companyId).get(file.key);
    if (!bytes) return apiError({ error: 'file_missing' }, 410);
    if (bytes.byteLength !== file.size || sha256Hex(bytes) !== file.sha256) {
      console.error(`export ${id}: stored file ${name} does not match its hash; refused`);
      return apiError({ error: 'hash_mismatch' }, 409);
    }
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        etag: `"${file.sha256}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
