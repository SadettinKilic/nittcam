/**
 * T023: project route handlers against an in-memory PGlite database (default company, D-016):
 * create → save → stale save (409) → commands stored → copy.
 */
import type { CommandLogEntry, Project } from '@nittcam/core';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type {
  ProjectApiError,
  ProjectDetail,
  ProjectListItem,
  SaveResponse,
} from '../../../lib/projects-api';
import { GET as list, POST as create } from './route';
import { GET as get, PATCH as patch, PUT as save } from './[id]/route';
import { POST as copy } from './[id]/copy/route';

const AT = '2026-11-17T10:00:00.000+03:00';

function project(): Project {
  return {
    schemaVersion: 2,
    machine: { machineId: 'draft', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project;
}

const json = (body: unknown, method = 'POST') =>
  new Request('http://test/api/projects', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const entry = (command: string, params: unknown): CommandLogEntry => ({
  command,
  params,
  actor: 'user',
  at: AT,
});

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<{ close(): Promise<void> }> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/projects', () => {
  it('create → save rev 1 → stale save 409 → commands stored → copy', async () => {
    const p = project();
    const created = await create(
      json({ name: 'Mutfak', project: p, commands: [entry('setGrain', { grain: 0 })] }),
    );
    expect(created.status).toBe(201);
    const detail = (await created.json()) as ProjectDetail;
    expect(detail).toMatchObject({ name: 'Mutfak', status: 'draft', revision: 1 });

    // Save on revision 1 → revision 2, commands appended.
    const thick = { ...p, stock: { ...p.stock, thickness: 16 } };
    const ok = await save(
      json(
        { project: thick, baseRevision: 1, commands: [entry('setThickness', { thickness: 16 })] },
        'PUT',
      ),
      ctx(detail.id),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as SaveResponse).revision).toBe(2);

    // A second tab still on revision 1 → 409 conflict, nothing written.
    const stale = await save(
      json(
        {
          project: { ...p, stock: { ...p.stock, thickness: 25 } },
          baseRevision: 1,
          commands: [entry('setThickness', { thickness: 25 })],
        },
        'PUT',
      ),
      ctx(detail.id),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()) as ProjectApiError).toEqual({
      error: 'conflict',
      currentRevision: 2,
    });

    const loaded = (await (
      await get(new Request('http://test'), ctx(detail.id))
    ).json()) as ProjectDetail;
    expect(loaded.revision).toBe(2);
    expect(loaded.project.stock.thickness).toBe(16);

    const scope = await companyScope();
    const rows = await scope.projects.listCommands(detail.id);
    expect(rows.map((r) => [r.revision, r.command])).toEqual([
      [1, 'setGrain'],
      [2, 'setThickness'],
    ]);

    // Copy: a new project, revision 1, same JSON, no history.
    const copied = await copy(json({ name: 'Mutfak (kopya)' }), ctx(detail.id));
    expect(copied.status).toBe(201);
    const c = (await copied.json()) as ProjectDetail;
    expect(c.id).not.toBe(detail.id);
    expect(c).toMatchObject({ name: 'Mutfak (kopya)', revision: 1, status: 'draft' });
    expect(c.project).toEqual(loaded.project);
    expect(await scope.projects.listCommands(c.id)).toEqual([]);

    // "Keep mine as a copy": the client's project JSON instead of the stored one.
    const mine = await copy(
      json({ name: 'Benim', project: { ...p, stock: { ...p.stock, thickness: 25 } } }),
      ctx(detail.id),
    );
    expect(((await mine.json()) as ProjectDetail).project.stock.thickness).toBe(25);

    const items = (await (await list()).json()) as ProjectListItem[];
    const item = items.find((i) => i.id === detail.id);
    expect(item).toMatchObject({ name: 'Mutfak', status: 'draft', material: 'mdf', thickness: 16 });
    expect(item?.machine).toBeNull();
  });

  it('T326: a repeated save or create (same saveId) is answered, never applied twice', async () => {
    const p = project();
    const id = crypto.randomUUID();
    const s1 = crypto.randomUUID();
    const createBody = {
      id,
      saveId: s1,
      name: 'Kapanis',
      project: p,
      commands: [entry('setGrain', { grain: 0 })],
    };
    expect((await create(json(createBody))).status).toBe(201);
    // The create again (the page closed before its answer): 200, same project.
    const again = await create(json(createBody));
    expect(again.status).toBe(200);
    expect(((await again.json()) as ProjectDetail).revision).toBe(1);
    // Another save id for that draft id is not the same create.
    expect((await create(json({ ...createBody, saveId: crypto.randomUUID() }))).status).toBe(409);

    const s2 = crypto.randomUUID();
    const put = {
      project: { ...p, stock: { ...p.stock, thickness: 16 } },
      baseRevision: 1,
      commands: [entry('setThickness', { thickness: 16 })],
      saveId: s2,
    };
    expect(((await (await save(json(put, 'PUT'), ctx(id))).json()) as SaveResponse).revision).toBe(
      2,
    );
    const repeat = await save(json(put, 'PUT'), ctx(id));
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as SaveResponse).revision).toBe(2);
    const loaded = (await (await get(new Request('http://test'), ctx(id))).json()) as ProjectDetail;
    expect(loaded).toMatchObject({ revision: 2, lastSaveId: s2 });
    // Once the project moved on, the create of the draft is a conflict (never a silent 200).
    expect((await create(json(createBody))).status).toBe(409);
    expect((await save(json({ ...put, saveId: 'nope' }, 'PUT'), ctx(id))).status).toBe(400);
    const scope = await companyScope();
    const cmds = await scope.projects.listCommands(id);
    expect(cmds.map((c) => c.command)).toEqual(['setGrain', 'setThickness']);
  });

  it('save records undo/redo history events', async () => {
    const created = (await (
      await create(json({ name: 'H', project: project() }))
    ).json()) as ProjectDetail;
    const res = await save(
      json(
        {
          project: project(),
          baseRevision: 1,
          commands: [entry('setGrain', { grain: 90 }), entry('undo', {})],
        },
        'PUT',
      ),
      ctx(created.id),
    );
    expect(res.status).toBe(200);
    const scope = await companyScope();
    expect((await scope.projects.listCommands(created.id)).map((r) => r.command)).toEqual([
      'setGrain',
      'undo',
    ]);
  });

  it('rejects bad input', async () => {
    expect((await create(json({ project: project() }))).status).toBe(400);
    expect((await create(json({ name: 'x', project: { nope: 1 } }))).status).toBe(400);
    const badLog = await create(
      json({ name: 'x', project: project(), commands: [entry('rm', {})] }),
    );
    expect(badLog.status).toBe(400);
    expect(((await badLog.json()) as ProjectApiError).error).toBe('invalid_commands');

    const created = (await (
      await create(json({ name: 'B', project: project() }))
    ).json()) as ProjectDetail;
    const noBase = await save(json({ project: project(), commands: [] }, 'PUT'), ctx(created.id));
    expect(noBase.status).toBe(400);
    const unknown = '00000000-0000-4000-8000-0000000000ff';
    expect((await get(new Request('http://test'), ctx(unknown))).status).toBe(404);
    expect((await get(new Request('http://test'), ctx('not-a-uuid'))).status).toBe(404);
    const missing = await save(
      json({ project: project(), baseRevision: 1, commands: [] }, 'PUT'),
      ctx(unknown),
    );
    expect(missing.status).toBe(404);
    expect((await copy(json({ name: 'k' }), ctx(unknown))).status).toBe(404);
  });

  it('T178: delete hides the project from the list, Geri al restores it', async () => {
    const created = (await (
      await create(json({ name: 'Silinecek', project: project() }))
    ).json()) as ProjectDetail;
    const ids = async () => ((await (await list()).json()) as ProjectListItem[]).map((i) => i.id);
    const del = await patch(json({ deleted: true }, 'PATCH'), ctx(created.id));
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ id: created.id, deleted: true });
    expect(await ids()).not.toContain(created.id);
    // kept on the server, but the direct link is blocked (T178 remaining part): 410
    expect((await get(new Request('http://test'), ctx(created.id))).status).toBe(410);
    const back = await patch(json({ deleted: false }, 'PATCH'), ctx(created.id));
    expect(await back.json()).toEqual({ id: created.id, deleted: false });
    expect(await ids()).toContain(created.id);
    // bad input / unknown id
    expect((await patch(json({ deleted: 'yes' }, 'PATCH'), ctx(created.id))).status).toBe(400);
    expect(
      (await patch(json({ deleted: true }, 'PATCH'), ctx('00000000-0000-4000-8000-000000000000')))
        .status,
    ).toBe(404);
  });
});
