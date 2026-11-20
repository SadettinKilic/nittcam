import { NextResponse } from 'next/server';
import { companyScope } from '../../../lib/server/company';
import {
  apiError,
  handleError,
  machineNames,
  readBody,
  readCommands,
  readName,
  toDetail,
  toListItem,
  UUID,
} from '../../../lib/server/projects';
import { versionNumbers } from '../../../lib/server/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects → the company's projects, most recently changed first. `?silinen=1` → the
 * soft-deleted ones ("Silinenler", T178), newest deletion first.
 */
export async function GET(request?: Request) {
  const deleted = request ? new URL(request.url).searchParams.get('silinen') === '1' : false;
  try {
    const scope = await companyScope();
    const [rows, names, latest, versions] = await Promise.all([
      deleted ? scope.projects.listDeleted() : scope.projects.list(),
      machineNames(scope),
      scope.exports.latestPerProject(),
      versionNumbers(scope),
    ]);
    const last = new Map(latest.map((e) => [e.projectId, e]));
    return NextResponse.json(rows.map((r) => toListItem(r, names, last, versions)));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/projects `{ id?, name, project, commands? }` → creates the project at revision 1 (status
 * taslak) with the commands that produced it (201, the project detail). With a client-generated
 * `id` (UUID, D-030) the create is idempotent: a repeat returns the stored project (200).
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  const name = readName(body?.['name']);
  const id = body?.['id'];
  if (!body || !name || body['project'] === undefined)
    return apiError({ error: 'bad_request' }, 400);
  if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) {
    return apiError({ error: 'bad_request' }, 400);
  }
  const commands = readCommands(body['commands']);
  if (!commands.ok) return commands.response;
  try {
    const scope = await companyScope();
    const values = { name, data: body['project'], commands: commands.entries };
    if (typeof id === 'string') {
      const res = await scope.projects.createOnce({ ...values, id: id.toLowerCase() });
      return NextResponse.json(toDetail(res.row), { status: res.created ? 201 : 200 });
    }
    const row = await scope.projects.create(values);
    return NextResponse.json(toDetail(row), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
