import { NextResponse } from 'next/server';
import { companyScope } from '../../../lib/server/company';
import {
  handleTemplateError,
  readTemplate,
  readyItems,
  templateError,
  toItem,
} from '../../../lib/server/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/templates[?archived=1] → the company templates, each at its latest version (T148), then
 * the ready library (T150, `ready: true`). Archived templates (T151) only with `archived=1`.
 */
export async function GET(request?: Request) {
  const withArchived = request ? new URL(request.url).searchParams.get('archived') === '1' : false;
  try {
    const scope = await companyScope();
    const rows = await scope.templates.listLatest();
    const items = rows
      .filter((r) => withArchived || r.template.archivedAt === null)
      .map((r) => toItem(r.template, r.version));
    return NextResponse.json([...items, ...readyItems()]);
  } catch (err) {
    return handleTemplateError(err);
  }
}

/**
 * POST /api/templates `{ template: { name, geometry, params } }` → a new company template at
 * version 1 (201; T147 "şablon olarak kaydet"). Single user for now: the admin-only rule of
 * spec §4.7 is enforced here once roles exist (T023).
 */
export async function POST(request: Request) {
  const draft = await readTemplate(request);
  if (draft === undefined) return templateError({ error: 'bad_request' }, 400);
  if ('issues' in draft) {
    return templateError({ error: 'invalid_template', issues: draft.issues }, 400);
  }
  try {
    const scope = await companyScope();
    const { template, version } = await scope.templates.createWithVersion(draft.name, {
      params: draft.params as unknown as Record<string, unknown>,
      geometry: draft.geometry as unknown as Record<string, unknown>,
    });
    return NextResponse.json(toItem(template, version), { status: 201 });
  } catch (err) {
    return handleTemplateError(err);
  }
}
