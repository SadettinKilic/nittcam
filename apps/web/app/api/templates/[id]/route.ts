import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';
import { handleTemplateError, templateError, toItem, UUID } from '../../../../lib/server/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/templates/:id[?version=n] → that version (default: the latest) of a company template. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return templateError({ error: 'not_found' }, 404);
  const v = new URL(request.url).searchParams.get('version');
  const wanted = v === null ? null : Number(v);
  if (wanted !== null && !(Number.isInteger(wanted) && wanted >= 1)) {
    return templateError({ error: 'bad_request' }, 400);
  }
  try {
    const scope = await companyScope();
    const template = await scope.templates.get(id);
    if (!template) return templateError({ error: 'not_found' }, 404);
    const version =
      wanted === null
        ? (await scope.templates.listVersions(id)).at(-1)
        : await scope.templates.getVersion(id, wanted);
    if (!version) return templateError({ error: 'not_found' }, 404);
    return NextResponse.json(toItem(template, version));
  } catch (err) {
    return handleTemplateError(err);
  }
}
