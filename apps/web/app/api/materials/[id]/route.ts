import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';
import {
  handleMaterialError,
  materialError,
  readMaterial,
  toItem,
} from '../../../../lib/server/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PUT /api/materials/:id `{ material }` → replaces the entry. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return materialError({ error: 'not_found' }, 404);
  const material = await readMaterial(request);
  if (material === undefined) return materialError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const row = await scope.materials.update(id, material);
    if (!row) return materialError({ error: 'not_found' }, 404);
    return NextResponse.json(toItem(row));
  } catch (err) {
    return handleMaterialError(err);
  }
}

/** DELETE /api/materials/:id → removes the entry (projects keep their stock values). */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return materialError({ error: 'not_found' }, 404);
  try {
    const scope = await companyScope();
    if (!(await scope.materials.remove(id))) return materialError({ error: 'not_found' }, 404);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleMaterialError(err);
  }
}
