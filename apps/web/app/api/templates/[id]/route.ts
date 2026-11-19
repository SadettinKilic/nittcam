import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';
import {
  handleTemplateError,
  readyItemOf,
  templateError,
  toItem,
  UUID,
} from '../../../../lib/server/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/templates/:id[?version=n] → that version (default: the latest) of a company template,
 * or of a ready library template (T150, `ready-…` ids).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const v = new URL(request.url).searchParams.get('version');
  const wanted = v === null ? null : Number(v);
  if (wanted !== null && !(Number.isInteger(wanted) && wanted >= 1)) {
    return templateError({ error: 'bad_request' }, 400);
  }
  if (!UUID.test(id)) {
    const ready = readyItemOf(id, wanted);
    return ready ? NextResponse.json(ready) : templateError({ error: 'not_found' }, 404);
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

/**
 * PATCH /api/templates/:id `{ archived: boolean }` → archives or restores a company template
 * (T151). Archived templates leave "Şablon ekle"; projects keep their copy (spec §4.7). Ready
 * library templates cannot be archived (404).
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return templateError({ error: 'not_found' }, 404);
  let archived: unknown;
  try {
    archived = ((await request.json()) as { archived?: unknown } | null)?.archived;
  } catch {
    return templateError({ error: 'bad_request' }, 400);
  }
  if (typeof archived !== 'boolean') return templateError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const updated = await scope.templates.update(id, { archivedAt: archived ? new Date() : null });
    if (!updated) return templateError({ error: 'not_found' }, 404);
    const version = (await scope.templates.listVersions(id)).at(-1);
    if (!version) return templateError({ error: 'not_found' }, 404);
    return NextResponse.json(toItem(updated, version));
  } catch (err) {
    return handleTemplateError(err);
  }
}
