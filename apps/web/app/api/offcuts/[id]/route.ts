import { materialHasGrain, materialKindOf } from '@nittcam/core';
import { NextResponse } from 'next/server';
import { companyScope } from '../../../../lib/server/company';
import { isUuid, offcutError, readOffcutPatch, toOffcutItem } from '../../../../lib/server/offcuts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/offcuts/:id
 * - `{ status }` and/or `{ material, thickness, width, height, grain }` → edits the offcut (T168
 *   status, T291 "Düzelt"); its source project and date stay.
 * - `{ deleted: boolean }` → soft deletes or restores it (T291 "Sil" / "Geri al"); a deleted offcut
 *   leaves the stock and the nesting, and comes back with the same id.
 * Company-scoped: another company's id is 404.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return offcutError({ error: 'not_found' }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return offcutError({ error: 'bad_request' }, 400);
  }
  const patch = readOffcutPatch(body);
  if (!patch) return offcutError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    if (patch.kind === 'edit') {
      // P3 (tester B36): a grainless material (MDF, sunta …) never keeps a grain direction, whether
      // the grain or the material is what changes.
      const edit = patch.edit;
      if (edit.grain != null || edit.material !== undefined) {
        const material = edit.material ?? (await scope.offcuts.get(id))?.material;
        if (material !== undefined && !materialHasGrain(materialKindOf(material))) {
          edit.grain = null;
        }
      }
    }
    const row =
      patch.kind === 'deleted'
        ? await scope.offcuts.setDeleted(id, patch.deleted)
        : await scope.offcuts.update(id, patch.edit);
    if (!row) return offcutError({ error: 'not_found' }, 404);
    return NextResponse.json({ ...toOffcutItem(row), deleted: row.deletedAt !== null });
  } catch (err) {
    console.error(err);
    return offcutError({ error: 'server_error' }, 500);
  }
}
