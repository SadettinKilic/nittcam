import { NextResponse } from 'next/server';
import { companyScope } from '../../../../../lib/server/company';
import {
  handleTemplateError,
  readTemplate,
  templateError,
  toItem,
  UUID,
} from '../../../../../lib/server/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/templates/:id/versions `{ template: { name, geometry, params } }` → the next immutable
 * version (201). Older versions never change, so projects keep their copy (spec §4.7).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return templateError({ error: 'not_found' }, 404);
  const draft = await readTemplate(request);
  if (draft === undefined) return templateError({ error: 'bad_request' }, 400);
  if ('issues' in draft) {
    return templateError({ error: 'invalid_template', issues: draft.issues }, 400);
  }
  try {
    const scope = await companyScope();
    const template = await scope.templates.get(id);
    if (!template) return templateError({ error: 'not_found' }, 404);
    const version = await scope.templates.addVersion(id, {
      params: draft.params as unknown as Record<string, unknown>,
      geometry: draft.geometry as unknown as Record<string, unknown>,
    });
    const named =
      draft.name === template.name
        ? template
        : ((await scope.templates.update(id, { name: draft.name })) ?? template);
    return NextResponse.json(toItem(named, version), { status: 201 });
  } catch (err) {
    return handleTemplateError(err);
  }
}
