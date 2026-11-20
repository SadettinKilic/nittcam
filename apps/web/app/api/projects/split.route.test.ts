/**
 * T292: POST /api/projects with `sourceProjectId` links the new project to its source; GET
 * /api/projects/:id/links lists both directions; a foreign, deleted or malformed source → 400.
 */
import { randomUUID } from 'node:crypto';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { newProject } from '../../../lib/draft-project';
import type { ProjectLinks } from '../../../lib/project-links';
import type { ProjectDetail } from '../../../lib/projects-api';
import { splitOffProject } from '../../../lib/split-project';
import { PATCH as patch } from './[id]/route';
import { GET as links } from './[id]/links/route';
import { POST as create } from './route';

const AT = '2026-11-20T10:00:00.000Z';
const json = (body: unknown) =>
  new Request('http://test/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const linksOf = async (id: string) =>
  (await (await links(new Request('http://test'), ctx(id))).json()) as ProjectLinks;

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('split-off projects (T292)', () => {
  it('creates the 8 mm project linked to its source; links both ways', async () => {
    const src = (await (
      await create(json({ name: 'Mutfak', project: newProject() }))
    ).json()) as ProjectDetail;
    const rows = [
      {
        id: 'back-1',
        name: 'Arkalık',
        qty: 1,
        grain: { mode: 'fixed', angle: 0 },
        params: { w: 564, h: 720, r: 0 },
      },
    ];
    const out = splitOffProject(src.project, rows, { material: 'mdf', thickness: 8 }, AT);
    if (!out) throw new Error('split rejected');
    const id = randomUUID();
    const res = await create(
      json({
        id,
        name: 'Mutfak · 8 mm',
        project: out.project,
        commands: out.commands,
        sourceProjectId: src.id,
      }),
    );
    expect(res.status).toBe(201);
    const made = (await res.json()) as ProjectDetail;
    expect(made.project.stock.thickness).toBe(8);
    expect(made.project.parts.map((p) => [p.name, p.qty])).toEqual([['Arkalık', 1]]);

    expect(await linksOf(src.id)).toEqual({
      source: null,
      derived: [{ id, name: 'Mutfak · 8 mm' }],
    });
    expect(await linksOf(id)).toEqual({
      source: { id: src.id, name: 'Mutfak' },
      derived: [],
    });
    expect((await links(new Request('http://test'), ctx(randomUUID()))).status).toBe(404);
    expect((await links(new Request('http://test'), ctx('nope'))).status).toBe(404);

    // A deleted source cannot take new split-offs.
    await patch(
      new Request('http://test', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deleted: true }),
      }),
      ctx(src.id),
    );
    const late = await create(json({ name: 'Geç', project: out.project, sourceProjectId: src.id }));
    expect(late.status).toBe(400);
  });

  it('rejects a malformed or another company source', async () => {
    expect(
      (await create(json({ name: 'X', project: newProject(), sourceProjectId: 'abc' }))).status,
    ).toBe(400);
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000002f2';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye T292' });
    const foreign = await forCompany(handle.db, otherId).projects.create({
      name: 'Yabancı',
      data: newProject(),
    });
    expect(
      (await create(json({ name: 'X', project: newProject(), sourceProjectId: foreign.id })))
        .status,
    ).toBe(400);
    expect((await links(new Request('http://test'), ctx(foreign.id))).status).toBe(404);
  });
});
