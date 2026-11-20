import { projectDefaultsSchema, resolveProjectDefaults } from '@nittcam/core';
import type { Company } from '@nittcam/db';
import { NextResponse } from 'next/server';
import { companyScope } from '../../../lib/server/company';
import { COMPANY_NAME_MAX, type CompanySettings } from '../../../lib/settings-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toSettings(company: Company): CompanySettings {
  return {
    name: company.name,
    logoUrl: company.logoKey ? `/api/settings/logo?v=${company.updatedAt.getTime()}` : null,
    defaults: resolveProjectDefaults(company.projectDefaults),
  };
}

const bad = () => NextResponse.json({ error: 'bad_request' }, { status: 400 });

/** GET /api/settings → company name, logo URL and project defaults (T182). */
export async function GET() {
  try {
    const company = await (await companyScope()).company.get();
    if (!company) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(toSettings(company));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

/**
 * PATCH /api/settings `{ name?, defaults? }` (T182): a non-empty name up to 120 characters; the
 * complete defaults object (`projectDefaultsSchema`). Applies to projects created afterwards.
 */
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad();
  const { name, defaults, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || (name === undefined && defaults === undefined)) return bad();
  const patch: { name?: string; projectDefaults?: Record<string, unknown> } = {};
  if (name !== undefined) {
    if (typeof name !== 'string') return bad();
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > COMPANY_NAME_MAX) return bad();
    patch.name = trimmed;
  }
  if (defaults !== undefined) {
    const parsed = projectDefaultsSchema.safeParse(defaults);
    if (!parsed.success) return bad();
    patch.projectDefaults = parsed.data;
  }
  try {
    const company = await (await companyScope()).company.update(patch);
    if (!company) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(toSettings(company));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
