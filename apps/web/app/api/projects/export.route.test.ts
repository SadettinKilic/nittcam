/**
 * T021 (D-030): NC export routes against an in-memory PGlite database and a temporary storage
 * folder. Export of the saved revision (byte-equal to `exportNc`, hash, record), stale revision 409,
 * failing checks 422 (nothing stored), unverified acceptance 428, idempotent repeat, determinism,
 * tenant isolation, tampered file refused, client-generated project ids.
 */
import { createHash, randomUUID } from 'node:crypto';
import { applyCommand, exportNc, nestingToolDiameter, type Project } from '@nittcam/core';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { POST_CONFIGS } from '@nittcam/machines';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { companyScope, companyStorage } from '../../../lib/server/company';
import type {
  ExportApiError,
  ExportPreview,
  ExportRecord,
  ExportResponse,
} from '../../../lib/exports-api';
import type { ProjectDetail, ProjectListItem } from '../../../lib/projects-api';
import { GET as list, POST as create } from './route';
import { PUT as save } from './[id]/route';
import { GET as preview, POST as doExport } from './[id]/export/route';
import { GET as history } from './[id]/exports/route';
import { GET as download } from '../exports/[id]/files/[name]/route';

const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const post = (body: unknown, method = 'POST') =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

let machine: { id: string; version: number; versionId: string };

/** A project on the seeded example machine: a few parts, nested. */
async function nestedProject(over: (p: Project) => Project = (p) => p): Promise<Project> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  if (!m) throw new Error('no seeded machine');
  const set = m.profile.materials[0];
  if (!set) throw new Error('no material set');
  let p: Project = over({
    schemaVersion: 2,
    machine: { machineId: m.machine.id, profileVersion: m.version.version },
    stock: {
      material: set.material,
      thickness: set.thickness,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project);
  const run = (name: string, params: unknown) => {
    const r = applyCommand(p, name, params);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    p = r.project;
  };
  run('addPart', { id: 'kapak', name: 'Kapak', qty: 2, params: { w: 400, h: 600, r: 0 } });
  run('addPart', { id: 'raf', name: 'Raf', qty: 2, params: { w: 500, h: 300, r: 0 } });
  run('runNesting', { toolDiameter: nestingToolDiameter(m.profile, p.stock) ?? 8 });
  return p;
}

async function createProject(name: string, project: Project): Promise<ProjectDetail> {
  const res = await create(post({ name, project }));
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectDetail;
}

beforeAll(async () => {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  if (!m) throw new Error('no seeded machine');
  machine = {
    id: m.machine.id,
    version: m.version.version,
    versionId: m.version.id,
  };
});

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('POST /api/projects/:id/export', () => {
  it('exports the saved revision: stored bytes = exportNc output, hash, record, download', async () => {
    const project = await nestedProject();
    const detail = await createProject('Mutfak dolabı', project);

    // Dry run first: same files, nothing stored.
    const pre = await preview(
      new Request(`http://test/x?revision=${detail.revision}`),
      ctx({ id: detail.id }),
    );
    expect(pre.status).toBe(200);
    const pv = (await pre.json()) as ExportPreview;
    expect(pv.ok).toBe(true);
    expect(pv.needsAcceptance).toBe(true);
    expect(pv.profile).toMatchObject({ machineId: machine.id, version: machine.version });
    expect(pv.checklist?.origin.corner).toBeTruthy();
    expect(pv.checklist?.tools.length).toBeGreaterThan(0);

    // Unverified (example) profile: no acceptance → 428, nothing stored.
    const noAccept = await doExport(post({ revision: detail.revision }), ctx({ id: detail.id }));
    expect(noAccept.status).toBe(428);
    expect(((await noAccept.json()) as ExportApiError).error).toBe('acceptance_required');
    const scope = await companyScope();
    expect(await scope.exports.listForProject(detail.id)).toEqual([]);

    const res = await doExport(
      post({ revision: detail.revision, acceptUnverified: true }),
      ctx({ id: detail.id }),
    );
    expect(res.status).toBe(201);
    const out = (await res.json()) as ExportResponse;
    expect(out.created).toBe(true);
    expect(out.files.map((f) => f.hash)).toEqual(pv.files.map((f) => f.hash));

    // The file the server stored is exactly what exportNc gives for this revision + version.
    const m = await scope.machines.getProfileVersion(machine.id, { version: machine.version });
    if (!m) throw new Error('profile version missing');
    const expected = exportNc(
      project,
      { profile: m.profile, version: m.version.version, verification: m.state },
      POST_CONFIGS[m.profile.post.id],
      { projectName: 'Mutfak dolabı', revision: detail.revision },
    );
    expect(expected.ok).toBe(true);
    expect(out.files.map((f) => f.name)).toEqual(expected.files.map((f) => f.name));
    const storage = companyStorage(scope.companyId);
    for (const [i, f] of out.files.entries()) {
      const want = expected.files[i]?.content ?? '';
      const stored = await storage.get(`exports/${out.exportId}/${f.name}`);
      expect(stored).not.toBeNull();
      expect(Buffer.from(stored as Uint8Array).toString('latin1')).toBe(want);
      expect(f.hash).toBe(sha(want));
      expect(f.size).toBe(Buffer.byteLength(want));
      expect(want.split(/\r?\n/)[0]).toBe('(DOGRULANMADI, once air cut)');
      expect(want).toContain('(PROJE: Mutfak dolabi)');
      expect(want).toContain(`(REVIZYON: ${detail.revision})`);
    }

    // The record.
    const row = await scope.exports.get(out.exportId);
    expect(row).toMatchObject({
      projectId: detail.id,
      projectRevision: detail.revision,
      machineProfileVersionId: machine.versionId,
      postId: m.profile.post.id,
      postVersion: (POST_CONFIGS[m.profile.post.id] as { version: string }).version,
      kind: 'nc',
      fileKey: `exports/${out.exportId}`,
      verificationState: 'draft',
      validationStage: 'draft',
      unverified: true,
    });
    expect(row?.acceptedUnverifiedAt).toBeInstanceOf(Date);
    expect(row?.acceptedBy).toBeTruthy();
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.sha256).toBe(sha(out.files.map((f) => `${f.hash}  ${f.name}\n`).join('')));

    // Download: same bytes, attachment with the file name.
    const first = out.files[0];
    if (!first) throw new Error('no file');
    const dl = await download(
      new Request('http://test'),
      ctx({ id: out.exportId, name: first.name }),
    );
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toBe(`attachment; filename="${first.name}"`);
    expect(first.name).toMatch(/^[A-Za-z0-9_-]+\.tap$/);
    expect(sha(new Uint8Array(await dl.arrayBuffer()))).toBe(first.hash);

    // Idempotent: the same request returns the same export; nothing new is stored.
    const again = await doExport(
      post({ revision: detail.revision, acceptUnverified: true }),
      ctx({ id: detail.id }),
    );
    expect(again.status).toBe(200);
    const twice = (await again.json()) as ExportResponse;
    expect(twice.created).toBe(false);
    expect(twice.exportId).toBe(out.exportId);
    expect(await scope.exports.listForProject(detail.id)).toHaveLength(1);
    expect(await storage.list(`exports/${out.exportId}/`)).toHaveLength(out.files.length);

    // History and the Projeler list show it.
    const h = (await (
      await history(new Request('http://test'), ctx({ id: detail.id }))
    ).json()) as ExportRecord[];
    expect(h.map((e) => e.exportId)).toEqual([out.exportId]);
    expect(h[0]?.profileVersion).toBe(machine.version);
    const items = (await (await list()).json()) as ProjectListItem[];
    expect(items.find((i) => i.id === detail.id)?.lastExport?.exportId).toBe(out.exportId);
  });

  it('determinism: the same revision + profile version gives the same hash', async () => {
    const project = await nestedProject();
    const a = await createProject('Aynı', project);
    const b = await createProject('Aynı', project);
    const hashes = async (id: string) =>
      (
        (await (
          await preview(new Request('http://test/x?revision=1'), ctx({ id }))
        ).json()) as ExportPreview
      ).files.map((f) => f.hash);
    const h1 = await hashes(a.id);
    expect(await hashes(a.id)).toEqual(h1);
    // Another project with the same name, revision and content: byte-identical files.
    expect(await hashes(b.id)).toEqual(h1);
  });

  it('a stale revision → 409, nothing stored', async () => {
    const project = await nestedProject();
    const detail = await createProject('Eski', project);
    const saved = await save(
      post({ project, baseRevision: 1, commands: [] }, 'PUT'),
      ctx({ id: detail.id }),
    );
    expect(saved.status).toBe(200);
    const res = await doExport(
      post({ revision: 1, acceptUnverified: true }),
      ctx({ id: detail.id }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', currentRevision: 2 });
    const pre = await preview(new Request('http://test/x?revision=1'), ctx({ id: detail.id }));
    expect(pre.status).toBe(409);
    const scope = await companyScope();
    expect(await scope.exports.listForProject(detail.id)).toEqual([]);
  });

  it('a failing project → 422 with Turkish violations, no file and no record', async () => {
    const scope = await companyScope();
    const before = await companyStorage(scope.companyId).list('exports/');
    // No cutting parameters for this material: the toolpath stage stops.
    const noParams = await nestedProject((p) => ({
      ...p,
      stock: { ...p.stock, material: 'akrilik', thickness: 3 },
    }));
    const d1 = await createProject('Akrilik', noParams);
    const r1 = await doExport(post({ revision: 1, acceptUnverified: true }), ctx({ id: d1.id }));
    expect(r1.status).toBe(422);
    const e1 = (await r1.json()) as Extract<ExportApiError, { error: 'export_failed' }>;
    expect(e1.error).toBe('export_failed');
    expect(e1.stage).toBe('toolpath');
    expect(e1.violations[0]).toMatchObject({
      stage: 'toolpath',
      rule: 'TOOLPATH',
      code: 'NO_CUTTING_PARAMS',
    });
    expect(e1.violations[0]?.message).toMatch(/kesim parametresi/);

    // A sheet far larger than the machine: the post or the checks refuse it.
    const huge = await nestedProject((p) => ({
      ...p,
      stock: { ...p.stock, sheet: { width: 9000, height: 9000, grain: 0 } },
    }));
    const d2 = await createProject('Dev plaka', huge);
    const r2 = await doExport(post({ revision: 1, acceptUnverified: true }), ctx({ id: d2.id }));
    expect(r2.status).toBe(422);
    const e2 = (await r2.json()) as Extract<ExportApiError, { error: 'export_failed' }>;
    expect(['post', 'check']).toContain(e2.stage);
    expect(e2.violations.length).toBeGreaterThan(0);
    expect(e2.violations.every((v) => v.severity === 'error' && v.message.length > 0)).toBe(true);

    for (const d of [d1, d2]) expect(await scope.exports.listForProject(d.id)).toEqual([]);
    expect(await companyStorage(scope.companyId).list('exports/')).toEqual(before);
  });

  it('a locked copy its grain does not allow → 422 LOCKED_PLACEMENT_GRAIN, nothing stored', async () => {
    const scope = await companyScope();
    // Fixed grain 0 on a grain-0 sheet allows rot 0/180; one copy is locked at 90 (as after a
    // grain change, D-034 amendment).
    const bad = await nestedProject((p) => p);
    const kapak = bad.parts.find((x) => x.id === 'kapak');
    if (!kapak) throw new Error('kapak missing');
    const regrained: Project = {
      ...bad,
      parts: bad.parts.map((x) =>
        x.id === 'kapak' ? { ...x, grain: { mode: 'fixed' as const, angle: 0 } } : x,
      ),
      layout: {
        sheets: bad.layout.sheets.map((s, si) => ({
          placements: s.placements.map((pl) => {
            if (si !== 0 || pl.partId !== 'kapak' || pl.index !== 0) return pl;
            return { ...pl, rot: 90, locked: true };
          }),
        })),
      },
    };
    const d = await createProject('Damar kilidi', regrained);
    const pre = await preview(new Request(`http://test/x?revision=1`), ctx({ id: d.id }));
    const pv = (await pre.json()) as ExportPreview;
    expect(pv.ok).toBe(false);
    expect(pv.files).toEqual([]);
    const r = await doExport(post({ revision: 1, acceptUnverified: true }), ctx({ id: d.id }));
    expect(r.status).toBe(422);
    const e = (await r.json()) as Extract<ExportApiError, { error: 'export_failed' }>;
    expect(e.stage).toBe('toolpath');
    expect(e.violations).toHaveLength(1);
    expect(e.violations[0]).toMatchObject({
      code: 'LOCKED_PLACEMENT_GRAIN',
      severity: 'error',
      sheet: 0,
    });
    expect(e.violations[0]?.message).toMatch(/damar yönüne uymuyor/);
    expect(await scope.exports.listForProject(d.id)).toEqual([]);
  });

  it('bad input', async () => {
    const project = await nestedProject();
    const d = await createProject('Girdi', project);
    expect((await doExport(post({}), ctx({ id: d.id }))).status).toBe(400);
    expect((await doExport(post({ revision: 0 }), ctx({ id: d.id }))).status).toBe(400);
    expect(
      (await doExport(post({ revision: 1, acceptUnverified: 'evet' }), ctx({ id: d.id }))).status,
    ).toBe(400);
    expect(
      (await doExport(post({ revision: 1, profileVersionId: 'x' }), ctx({ id: d.id }))).status,
    ).toBe(400);
    expect((await doExport(post({ revision: 1 }), ctx({ id: randomUUID() }))).status).toBe(404);
    expect((await preview(new Request('http://test/x'), ctx({ id: d.id }))).status).toBe(400);
    // A profile version id that is not one of the project's machine → profile stage error.
    const r = await doExport(
      post({ revision: 1, profileVersionId: randomUUID(), acceptUnverified: true }),
      ctx({ id: d.id }),
    );
    expect(r.status).toBe(422);
    expect(((await r.json()) as { stage: string }).stage).toBe('profile');
  });

  it('uses the profile version stored on the project, not the latest', async () => {
    const scope = await companyScope();
    const project = await nestedProject();
    const d = await createProject('Sürüm', project);
    const before = (await (
      await preview(new Request('http://test/x?revision=1'), ctx({ id: d.id }))
    ).json()) as ExportPreview;
    // A new profile version (rapid feed changed): the project still exports with its version.
    const m = await scope.machines.getWithProfile(machine.id);
    if (!m) throw new Error('machine');
    await scope.machines.saveProfile(machine.id, {
      ...m.profile,
      rapidFeed: (m.profile.rapidFeed ?? 10_000) + 1,
    });
    const after = (await (
      await preview(new Request('http://test/x?revision=1'), ctx({ id: d.id }))
    ).json()) as ExportPreview;
    expect(after.profile?.version).toBe(machine.version);
    expect(after.profile?.latestVersion).toBe(machine.version + 1);
    expect(after.files.map((f) => f.hash)).toEqual(before.files.map((f) => f.hash));
  });
});

describe('GET /api/exports/:id/files/:name', () => {
  it('refuses a tampered stored file (hash re-check) and a missing one', async () => {
    const project = await nestedProject();
    const d = await createProject('Kurcalanmış', project);
    const out = (await (
      await doExport(post({ revision: 1, acceptUnverified: true }), ctx({ id: d.id }))
    ).json()) as ExportResponse;
    const f = out.files[0];
    if (!f) throw new Error('no file');
    const scope = await companyScope();
    const storage = companyStorage(scope.companyId);
    const key = `exports/${out.exportId}/${f.name}`;
    const original = (await storage.get(key)) as Uint8Array;
    // Same size, one coordinate digit changed.
    const text = Buffer.from(original).toString('latin1');
    const tampered = text.replace(/X(\d)/, (_m, d: string) => `X${(Number(d) + 1) % 10}`);
    expect(tampered).not.toBe(text);
    await storage.put(key, tampered);
    const res = await download(new Request('http://test'), ctx({ id: out.exportId, name: f.name }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'hash_mismatch' });
    await storage.delete(key);
    expect(
      (await download(new Request('http://test'), ctx({ id: out.exportId, name: f.name }))).status,
    ).toBe(410);
    await storage.put(key, original);
    expect(
      (await download(new Request('http://test'), ctx({ id: out.exportId, name: f.name }))).status,
    ).toBe(200);
    // Names outside the record or unsafe → 404.
    for (const name of ['x.tap', '..', '..%2Fx', 'a b.tap']) {
      expect(
        (await download(new Request('http://test'), ctx({ id: out.exportId, name }))).status,
      ).toBe(404);
    }
  });

  it("tenant isolation: another company's project and export are invisible", async () => {
    const own = await companyScope();
    const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
    const handle = await cache.nittcamDb;
    if (!handle) throw new Error('db');
    const other = forCompany(
      handle.db,
      (await companies.create(handle.db, { name: 'Başka atölye' })).id,
    );
    const m = await other.machines.createWithProfile(
      (await own.machines.getWithProfile(machine.id))?.profile,
    );
    const project = await nestedProject();
    const theirs = await other.projects.create({
      name: 'Onların',
      data: { ...project, machine: { machineId: m.machine.id, profileVersion: 1 } },
    });
    const user = await other.users.ensureDefault({
      email: `x-${randomUUID()}@test.local`,
      name: 'X',
    });
    const theirExport = await other.exports.createOnce({
      projectId: theirs.id,
      projectRevision: 1,
      machineProfileVersionId: m.version.id,
      postId: 'mach3',
      postVersion: '1.0.0',
      kind: 'nc',
      fileKey: 'exports/z',
      sha256: sha('z'),
      files: [{ name: 'Z_S1.tap', key: 'exports/z/Z_S1.tap', size: 1, sha256: sha('z'), sheet: 0 }],
      validationStage: 'draft',
      verificationState: 'draft',
      unverified: true,
      acceptedUnverifiedAt: new Date(),
      acceptedBy: user.id,
    });
    await companyStorage(other.companyId).put('exports/z/Z_S1.tap', 'z');

    const id = theirExport.row.id;
    expect((await download(new Request('http://test'), ctx({ id, name: 'Z_S1.tap' }))).status).toBe(
      404,
    );
    expect(
      (await doExport(post({ revision: 1, acceptUnverified: true }), ctx({ id: theirs.id })))
        .status,
    ).toBe(404);
    expect(
      (await preview(new Request('http://test/x?revision=1'), ctx({ id: theirs.id }))).status,
    ).toBe(404);
    expect((await history(new Request('http://test'), ctx({ id: theirs.id }))).status).toBe(404);
    const items = (await (await list()).json()) as ProjectListItem[];
    expect(items.some((i) => i.id === theirs.id || i.lastExport?.exportId === id)).toBe(false);
  });
});

describe('POST /api/projects with a client-generated id', () => {
  it('is idempotent on the id (a reload during the first save creates no duplicate)', async () => {
    const project = await nestedProject();
    const id = randomUUID();
    const first = await create(post({ id, name: 'İlk', project, commands: [] }));
    expect(first.status).toBe(201);
    expect(((await first.json()) as ProjectDetail).id).toBe(id);
    const again = await create(post({ id, name: 'İlk', project, commands: [] }));
    expect(again.status).toBe(200);
    expect((await again.json()) as ProjectDetail).toMatchObject({ id, revision: 1, name: 'İlk' });
    const items = (await (await list()).json()) as ProjectListItem[];
    expect(items.filter((i) => i.id === id)).toHaveLength(1);
    expect((await create(post({ id: 'nope', name: 'x', project }))).status).toBe(400);
    expect((await create(post({ id: 42, name: 'x', project }))).status).toBe(400);
  });
});
