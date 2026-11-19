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

/** PUT `{ layers }` → merges the chosen operations into the company mapping, returns `{ map }`. */
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = dxfLayerChoiceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try {
    const map = mergeLayerMap(await stored(), parsed.data.layers);
    await (await companyScope()).company.update({ dxfLayerMap: map });
    return NextResponse.json({ map });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
