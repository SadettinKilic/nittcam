import { NextResponse } from 'next/server';
import { companyScope, companyStorage } from '../../../../lib/server/company';
import {
  LOGO_CONTENT_TYPE,
  LOGO_MAX_BYTES,
  logoKey,
  logoProblem,
  sniffLogo,
} from '../../../../lib/logo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number) => NextResponse.json(body, { status });

/** GET /api/settings/logo → the company logo bytes (T182); 404 when none is uploaded. */
export async function GET() {
  try {
    const scope = await companyScope();
    const company = await scope.company.get();
    if (!company?.logoKey) return json({ error: 'not_found' }, 404);
    const bytes = await companyStorage(company.id).get(company.logoKey);
    const type = bytes ? sniffLogo(bytes) : null;
    if (!bytes || !type) return json({ error: 'not_found' }, 404);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': LOGO_CONTENT_TYPE[type],
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'server_error' }, 500);
  }
}

/**
 * POST /api/settings/logo, multipart field `file` (T182): PNG, JPEG or WebP (by its bytes), at
 * most 512 KB. Replaces the previous logo. 400 `{ error: 'empty' | 'size' | 'type' }`.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? '0');
  // multipart overhead aside, a body far over the limit is refused before it is read
  if (declared > LOGO_MAX_BYTES + 64 * 1024) return json({ error: 'size' }, 413);
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!file || typeof file === 'string') return json({ error: 'bad_request' }, 400);
  if (file.size > LOGO_MAX_BYTES) return json({ error: 'size' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = logoProblem(bytes);
  const type = sniffLogo(bytes);
  if (problem || !type) return json({ error: problem ?? 'type' }, 400);
  try {
    const scope = await companyScope();
    const company = await scope.company.get();
    if (!company) return json({ error: 'not_found' }, 404);
    const storage = companyStorage(company.id);
    const key = logoKey(type);
    await storage.put(key, bytes);
    if (company.logoKey && company.logoKey !== key) await storage.delete(company.logoKey);
    const updated = await scope.company.update({ logoKey: key });
    return NextResponse.json({
      logoUrl: `/api/settings/logo?v=${(updated ?? company).updatedAt.getTime()}`,
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'server_error' }, 500);
  }
}

/** DELETE /api/settings/logo → removes the logo (T182). */
export async function DELETE() {
  try {
    const scope = await companyScope();
    const company = await scope.company.get();
    if (!company) return json({ error: 'not_found' }, 404);
    if (company.logoKey) {
      await companyStorage(company.id).delete(company.logoKey);
      await scope.company.update({ logoKey: null });
    }
    return NextResponse.json({ logoUrl: null });
  } catch (err) {
    console.error(err);
    return json({ error: 'server_error' }, 500);
  }
}
