import { NextResponse } from 'next/server';
import { companyScope } from '../../../lib/server/company';
import {
  handleTemplateError,
  readTemplate,
  templateError,
  toItem,
} from '../../../lib/server/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/templates → the company templates, each at its latest version (T148). */
export async function GET() {
  try {
    const scope = await companyScope();
    const rows = await scope.templates.listLatest();
    return NextResponse.json(rows.map((r) => toItem(r.template, r.version)));
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
