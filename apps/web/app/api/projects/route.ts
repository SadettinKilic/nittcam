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

/** GET /api/projects → the company's projects, most recently changed first. */
export async function GET() {
  try {
    const scope = await companyScope();
    const [rows, names, latest, versions] = await Promise.all([
      scope.projects.list(),
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
 * POST /api/projects `{ id?, name, project, commands?, sourceProjectId? }` → creates the project at
 * revision 1 (status taslak) with the commands that produced it (201, the project detail). With a
 * client-generated `id` (UUID, D-030) the create is idempotent: a repeat returns the stored project
 * (200). T292: `sourceProjectId` links a project split off from another one.
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
  const source = body['sourceProjectId'];
  if (source !== undefined && (typeof source !== 'string' || !UUID.test(source))) {
    return apiError({ error: 'bad_request' }, 400);
  }
  try {
    const scope = await companyScope();
    // T292: the source must be a live project of the company (another company's id → 400).
    const sourceProjectId = typeof source === 'string' ? source.toLowerCase() : null;
    const sourceRow = sourceProjectId ? await scope.projects.get(sourceProjectId) : null;
    if (sourceProjectId && (!sourceRow || sourceRow.deletedAt !== null)) {
      return apiError({ error: 'bad_request' }, 400);
    }
    const values = { name, data: body['project'], commands: commands.entries, sourceProjectId };
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
