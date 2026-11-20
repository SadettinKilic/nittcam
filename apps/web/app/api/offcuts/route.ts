import { NextResponse } from 'next/server';
import { companyScope } from '../../../lib/server/company';
import {
  offcutError,
  readCreateBody,
  sortOffcuts,
  toInsert,
  toOffcutItem,
} from '../../../lib/server/offcuts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/offcuts[?material=&thickness=&status=] → the company offcut stock (T168), newest first.
 * The filters narrow the list (the nesting loads `status=available` of its material and thickness).
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const material = q.get('material');
  const thickness = q.get('thickness');
  const status = q.get('status');
  try {
    const scope = await companyScope();
    const rows = (await scope.offcuts.list()).filter(
      (r) =>
        (material === null || r.material === material) &&
        (thickness === null || r.thickness === Number(thickness)) &&
        (status === null || r.status === status),
    );
    return NextResponse.json(sortOffcuts(rows.map(toOffcutItem)));
  } catch (err) {
    console.error(err);
    return offcutError({ error: 'server_error' }, 500);
  }
}

/** POST /api/offcuts `{ offcuts: NewOffcut[] }` → saves confirmed leftovers (201). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return offcutError({ error: 'bad_request' }, 400);
  }
  const offcuts = readCreateBody(body);
  if (!offcuts) return offcutError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const created = [];
    for (const o of offcuts) {
      // A source project of another company (or a deleted one) is dropped, never linked.
      const source =
        o.sourceProjectId && (await scope.projects.get(o.sourceProjectId))
          ? o.sourceProjectId
          : null;
      created.push(await scope.offcuts.create(toInsert({ ...o, sourceProjectId: source })));
    }
    return NextResponse.json(created.map(toOffcutItem), { status: 201 });
  } catch (err) {
    console.error(err);
    return offcutError({ error: 'server_error' }, 500);
  }
}
