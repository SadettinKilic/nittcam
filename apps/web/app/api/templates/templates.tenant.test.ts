/**
 * B17 tester (T147): the template routes only work in the default company. A template of another
 * company (inserted through the db repository) is not listed, cannot be read (any version) and
 * cannot get a new version; its versions stay unchanged. Versions are immutable: a new version
 * never changes an older one, and there is no route that writes a version in place.
 */
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { TemplateItem } from '../../../lib/templates-api';
import * as one from './[id]/route';
import * as versions from './[id]/versions/route';
import * as root from './route';

const json = (body: unknown) =>
  new Request('http://test', {
    method: 'POST',
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

describe('/api/templates multi-tenancy and immutability (B17 tester)', () => {
  it('another company template is invisible and cannot be versioned through the routes', async () => {
    await companyScope();
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000000bb';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye' });
    const other = forCompany(handle.db, otherId);
    const foreign = await other.templates.createWithVersion('Yabancı menteşe', {
      params: hinge.params,
      geometry: hinge.geometry,
    });
    const id = foreign.template.id;

    const items = (await (await root.GET()).json()) as TemplateItem[];
    expect(items.some((i) => i.id === id)).toBe(false);
    expect((await one.GET(new Request('http://test'), ctx(id))).status).toBe(404);
    expect((await one.GET(new Request('http://test?version=1'), ctx(id))).status).toBe(404);
    expect((await versions.POST(json({ template: hinge }), ctx(id))).status).toBe(404);

    // Untouched in its own company: still one version with the original name.
    const vs = await other.templates.listVersions(id);
    expect(vs.map((v) => v.version)).toEqual([1]);
    expect((await other.templates.get(id))?.name).toBe('Yabancı menteşe');

    // Our own templates never show up for the other company.
    const mine = (await (await root.POST(json({ template: hinge }))).json()) as TemplateItem;
    expect(await other.templates.getVersion(mine.id, 1)).toBeNull();
    expect((await other.templates.listLatest()).some((r) => r.template.id === mine.id)).toBe(false);
  });

  it('versions are immutable: v1 stays byte-equal after v2/v3; bad version queries refused', async () => {
    const created = (await (await root.POST(json({ template: hinge }))).json()) as TemplateItem;
    const v1 = await (await one.GET(new Request('http://test?version=1'), ctx(created.id))).json();
    for (const spacing of [600, 700]) {
      const r = await versions.POST(
        json({ template: { ...hinge, params: { ...hinge.params, spacing } } }),
        ctx(created.id),
      );
      expect(r.status).toBe(201);
    }
    const again = await (
      await one.GET(new Request('http://test?version=1'), ctx(created.id))
    ).json();
    expect(again).toEqual(v1);
    const latest = (await (
      await one.GET(new Request('http://test'), ctx(created.id))
    ).json()) as TemplateItem;
    expect(latest.version).toBe(3);
    expect(latest.params.spacing).toBe(700);
    for (const q of ['0', '-1', '1.5', 'abc', '']) {
      const r = await one.GET(new Request(`http://test?version=${q}`), ctx(created.id));
      expect(r.status, q).toBe(400);
    }
    expect((await one.GET(new Request('http://test?version=9'), ctx(created.id))).status).toBe(404);
    // No route writes or deletes a version in place.
    for (const mod of [one, versions, root] as Record<string, unknown>[]) {
      expect(mod['PUT']).toBeUndefined();
      expect(mod['PATCH']).toBeUndefined();
      expect(mod['DELETE']).toBeUndefined();
    }
  });
});
