import {
  dxfLayerChoiceSchema,
  dxfLayerMapSchema,
  mergeLayerMap,
  type DxfLayerMap,
} from '@nittcam/core';
import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `{ map }` and nothing else: the editor's whole mapping. */
function replaceBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { success: false as const };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'map') return { success: false as const };
  return dxfLayerMapSchema.safeParse((body as { map: unknown }).map);
}

async function stored(): Promise<DxfLayerMap> {
  const company = await (await companyScope()).company.get();
  const parsed = dxfLayerMapSchema.safeParse(company?.dxfLayerMap ?? {});
  return parsed.success ? parsed.data : {};
}

/** GET /api/settings/dxf-layers → `{ map }`: the company's DXF layer → operation mapping (T145). */
export async function GET() {
  try {
    return NextResponse.json({ map: await stored() });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

/**
 * PUT `{ layers }` → merges the chosen operations into the company mapping (DXF import, T145);
 * PUT `{ map }` → replaces the whole mapping (Ayarlar → DXF katmanları editor, T182). Keys are
 * normalised and `auto` entries dropped either way. Returns `{ map }`.
 */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const replace = replaceBody(body);
  const parsed = replace.success ? null : dxfLayerChoiceSchema.safeParse(body);
  if (!replace.success && !parsed?.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const map = replace.success
      ? mergeLayerMap({}, replace.data)
      : mergeLayerMap(await stored(), parsed?.data?.layers ?? {});
    await (await companyScope()).company.update({ dxfLayerMap: map });
    return NextResponse.json({ map });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
