/** T147–T149: the template library API against an in-memory PGlite database. */
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import type { TemplateApiError, TemplateItem } from '../../../lib/templates-api';
import { GET as GET_ONE, PATCH } from './[id]/route';
import { GET as GET_VERSIONS, POST as POST_VERSION } from './[id]/versions/route';
import { GET, POST } from './route';

const json = (method: string, body: unknown) =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const hinge = {
  name: 'Menteşe',
  geometry: {
    holes: [{ id: 'h1', type: 'pocket', d: 35, cx: 0, cy: 0, depth: 13, tool: 2 }],
    inners: [],
  },
  params: { count: 2, spacing: 500, edgeDistance: 22.5, d: {} },
};

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/templates (T147)', () => {
  it('saves a template at version 1, lists it, adds immutable versions', async () => {
    const res = await POST(json('POST', { template: hinge }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as TemplateItem;
    expect(created).toMatchObject({ name: 'Menteşe', version: 1, params: hinge.params });
    const list = (await (await GET()).json()) as TemplateItem[];
    expect(list.map((t) => t.id)).toContain(created.id);
    // T150: the ready library follows the company templates, read-only and unverified.
    const ready = list.filter((t) => t.ready);
    expect(ready.map((t) => t.id)).toContain('ready-hinge-35-2');
    expect(ready.every((t) => t.verified === false)).toBe(true);
    expect(list.slice(list.findIndex((t) => t.ready)).every((t) => t.ready)).toBe(true);
    const one = await GET_ONE(new Request('http://test'), ctx('ready-handle-128'));
    expect(((await one.json()) as TemplateItem).params.spacing).toBe(128);
    expect(
      (await GET_ONE(new Request('http://test?version=2'), ctx('ready-handle-128'))).status,
    ).toBe(404);
    expect(
      (await POST_VERSION(json('POST', { template: hinge }), ctx('ready-handle-128'))).status,
    ).toBe(404);

    const v2 = await POST_VERSION(
      json('POST', { template: { ...hinge, params: { ...hinge.params, spacing: 600 } } }),
      ctx(created.id),
    );
    expect(v2.status).toBe(201);
    expect(((await v2.json()) as TemplateItem).version).toBe(2);
    const latest = (await (
      await GET_ONE(new Request('http://test'), ctx(created.id))
    ).json()) as TemplateItem;
    expect(latest.params.spacing).toBe(600);
    const first = (await (
      await GET_ONE(new Request('http://test?version=1'), ctx(created.id))
    ).json()) as TemplateItem;
    expect(first.params.spacing).toBe(500);
  });

  it('rejects invalid templates with issues; unknown ids are 404', async () => {
    const bad = await POST(
      json('POST', { template: { ...hinge, params: { ...hinge.params, count: 0 } } }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()) as TemplateApiError).toMatchObject({ error: 'invalid_template' });
    const noName = await POST(json('POST', { template: { ...hinge, name: ' ' } }));
    expect(noName.status).toBe(400);
    const badD = await POST(
      json('POST', { template: { ...hinge, params: { ...hinge.params, d: { zz: 5 } } } }),
    );
    expect(badD.status).toBe(400);
    expect((await POST(json('POST', { nope: 1 }))).status).toBe(400);
    expect((await GET_ONE(new Request('http://test'), ctx('not-a-uuid'))).status).toBe(404);
    const missing = '00000000-0000-4000-8000-00000000abcd';
    expect((await GET_ONE(new Request('http://test'), ctx(missing))).status).toBe(404);
    expect((await POST_VERSION(json('POST', { template: hinge }), ctx(missing))).status).toBe(404);
  });

  it('T151: version history, archive hides from the list (kept with ?archived=1), restore', async () => {
    const created = (await (
      await POST(json('POST', { template: { ...hinge, name: 'Arşivlik' } }))
    ).json()) as TemplateItem;
    await POST_VERSION(
      json('POST', { template: { ...hinge, params: { ...hinge.params, count: 3 } } }),
      ctx(created.id),
    );
    const history = (await (
      await GET_VERSIONS(new Request('http://test'), ctx(created.id))
    ).json()) as TemplateItem[];
    expect(history.map((v) => [v.version, v.params.count])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(history.every((v) => typeof v.createdAt === 'string')).toBe(true);

    const arch = await PATCH(json('PATCH', { archived: true }), ctx(created.id));
    expect(((await arch.json()) as TemplateItem).archived).toBe(true);
    const ids = async (url: string) =>
      ((await (await GET(new Request(url))).json()) as TemplateItem[]).map((t) => t.id);
    expect(await ids('http://test/api/templates')).not.toContain(created.id);
    expect(await ids('http://test/api/templates?archived=1')).toContain(created.id);
    await PATCH(json('PATCH', { archived: false }), ctx(created.id));
    expect(await ids('http://test/api/templates')).toContain(created.id);

    expect((await PATCH(json('PATCH', { archived: 'yes' }), ctx(created.id))).status).toBe(400);
    expect((await PATCH(json('PATCH', { archived: true }), ctx('ready-handle-96'))).status).toBe(
      404,
    );
    const ready = (await (
      await GET_VERSIONS(new Request('http://test'), ctx('ready-handle-96'))
    ).json()) as TemplateItem[];
    expect(ready.map((v) => v.version)).toEqual([1]);
  });
});
