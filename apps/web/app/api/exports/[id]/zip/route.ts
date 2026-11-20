import { companyScope, companyStorage } from '../../../../../lib/server/company';
import { apiError, sha256Hex } from '../../../../../lib/server/exports';
import { documentKind, exportFileName } from '../../../../../lib/file-names';
import { isDocumentType } from '../../../../../lib/server/documents';
import { UUID } from '../../../../../lib/server/projects';
import { exportReadme } from '../../../../../lib/server/readme';
import { zipStore } from '../../../../../lib/server/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/exports/:id/zip → "Tümünü indir (.zip)" (T176, CTO #10 E4): every stored file of the
 * export, byte for byte the single downloads (each checked against its stored size and sha256 like
 * the single download), plus `OKU.txt` mapping sheet → file. Same export → same zip bytes.
 * Tenant-scoped (404); an unverified export without acceptance is refused (428, rule 10).
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/exports/[id]/zip'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  try {
    const scope = await companyScope();
    const row = await scope.exports.get(id);
    if (!row) return apiError({ error: 'not_found' }, 404);
    if (row.unverified && row.acceptedUnverifiedAt === null) {
      return apiError({ error: 'acceptance_required' }, 428);
    }
    const storage = companyStorage(scope.companyId);
    const entries = [];
    for (const file of row.files) {
      const bytes = await storage.get(file.key);
      if (!bytes) return apiError({ error: 'file_missing' }, 410);
      if (bytes.byteLength !== file.size || sha256Hex(bytes) !== file.sha256) {
        console.error(`export ${id}: stored file ${file.name} does not match its hash; refused`);
        return apiError({ error: 'hash_mismatch' }, 409);
      }
      entries.push({ name: file.name, bytes });
    }
    const project = await scope.projects.get(row.projectId);
    const readme = exportReadme(row, project?.name ?? '');
    const zip = zipStore([
      ...entries,
      { name: 'OKU.txt', bytes: new TextEncoder().encode(readme) },
    ]);
    const kind =
      row.kind !== 'nc' && isDocumentType(row.postId) ? documentKind(row.postId) : row.kind;
    const name = exportFileName(project?.name ?? '', row.projectRevision, kind, 'zip');
    return new Response(Buffer.from(zip), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': String(zip.byteLength),
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        etag: `"${sha256Hex(zip)}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
