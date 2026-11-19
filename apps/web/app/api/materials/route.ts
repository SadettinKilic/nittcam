import { NextResponse } from 'next/server';
import { companyScope } from '../../../lib/server/company';
import {
  handleMaterialError,
  materialError,
  readMaterial,
  sortItems,
  toItem,
} from '../../../lib/server/materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/materials → the company material library (T121), by name. */
export async function GET() {
  try {
    const scope = await companyScope();
    return NextResponse.json(sortItems((await scope.materials.list()).map(toItem)));
  } catch (err) {
    return handleMaterialError(err);
  }
}

/** POST /api/materials `{ material }` → creates a library entry (201). */
export async function POST(request: Request) {
  const material = await readMaterial(request);
  if (material === undefined) return materialError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    return NextResponse.json(toItem(await scope.materials.create(material)), { status: 201 });
  } catch (err) {
    return handleMaterialError(err);
  }
}
