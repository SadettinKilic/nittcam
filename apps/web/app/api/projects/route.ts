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
} from '../../../lib/server/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/projects → the company's projects, most recently changed first. */
export async function GET() {
  try {
    const scope = await companyScope();
    const [rows, names] = await Promise.all([scope.projects.list(), machineNames(scope)]);
    return NextResponse.json(rows.map((r) => toListItem(r, names)));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/projects `{ name, project, commands? }` → creates the project at revision 1 (status
 * taslak) with the commands that produced it (201, the project detail).
 */
export async function POST(request: Request) {
  const body = await readBody(request);
  const name = readName(body?.['name']);
  if (!body || !name || body['project'] === undefined)
    return apiError({ error: 'bad_request' }, 400);
  const commands = readCommands(body['commands']);
  if (!commands.ok) return commands.response;
  try {
    const scope = await companyScope();
    const row = await scope.projects.create({
      name,
      data: body['project'],
      commands: commands.entries,
    });
    return NextResponse.json(toDetail(row), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
