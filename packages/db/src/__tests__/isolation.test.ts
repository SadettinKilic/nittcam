/**
 * Tenant isolation (spec §8.6): for every scoped resource, company A cannot list, get or update
 * company B's rows, and cannot insert rows that point at B's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { tenantTables } from '../schema';
import { forCompany, type CompanyScope } from '../tenant';
import { AT, loadFixture, newCompany, openTestDb } from './helpers';

type Seed = Awaited<ReturnType<typeof seed>>;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing seed row');
  return value;
}

/** Inserts one row into every tenant table for a company. */
async function seed(scope: CompanyScope) {
  const user = await scope.users.create({
    email: `${scope.companyId}@example.com`,
    role: 'admin',
  });
  const machine = await scope.machines.create({ name: 'Router', brand: 'X', model: 'Y' });
  const profileVersion = await scope.machines.addProfileVersion(machine.id, {
    profile: { travel: { x: 2800 } },
    postConfig: { dialect: 'generic' },
    postVersion: '1.0.0',
  });
  const tool = await scope.tools.create({
    machineId: machine.id,
    number: 1,
    type: 'flat',
    diameter: 6,
  });
  const material = await scope.materials.create({
    name: 'MDF 18',
    kind: 'mdf',
    thicknesses: [18],
    tone: 'natural',
    grain: null,
    sheetSizes: [{ width: 2800, height: 2070 }],
  });
  const template = await scope.templates.create({ name: 'Kapak' });
  const templateVersion = await scope.templates.addVersion(template.id, {
    params: { w: 400 },
    geometry: {},
  });
  const project = await scope.projects.create({ name: 'P', data: loadFixture('shelf-set') });
  const saved = await scope.projects.save(project.id, {
    revision: project.revision,
    data: project.data,
    commands: [{ command: 'renamePart', params: { id: 'side', name: 'x' }, actor: 'user', at: AT }],
    userId: user.id,
  });
  const [command] = await scope.projects.listCommands(project.id);
  const exportRow = await scope.exports.create({
    projectId: project.id,
    projectRevision: saved.revision,
    machineProfileVersionId: profileVersion.id,
    postId: 'generic',
    postVersion: '1.0.0',
    kind: 'nc',
    unverified: true,
    acceptedUnverifiedAt: new Date(AT),
    acceptedBy: user.id,
    fileKey: `${scope.companyId}/exports/a.nc`,
    sha256: '0'.repeat(64),
    validationStage: 'draft',
    createdBy: user.id,
  });
  const validation = await scope.validations.create({
    machineProfileVersionId: profileVersion.id,
    toolSet: [{ number: 1, diameter: 6 }],
    postVersion: '1.0.0',
    stage: 'air_cut_approved',
    approvedBy: user.id,
  });
  const offcut = await scope.offcuts.create({
    material: 'mdf',
    thickness: 18,
    width: 500,
    height: 300,
    grain: 0,
    sourceProjectId: project.id,
  });
  const chat = await scope.chatMessages.create({
    projectId: project.id,
    role: 'user',
    content: 'merhaba',
    userId: user.id,
  });
  const usage = await scope.aiUsage.record('2026-11-01', { requests: 1, inputTokens: 10 });
  return {
    users: user,
    machines: machine,
    machineProfileVersions: profileVersion,
    tools: tool,
    materials: material,
    templates: template,
    templateVersions: templateVersion,
    projects: saved,
    projectCommands: required(command),
    exports: exportRow,
    validations: validation,
    offcuts: offcut,
    chatMessages: chat,
    aiUsage: usage,
  };
}

/** Scope key → a harmless patch for resources that have `update`. */
const PATCHES: Partial<Record<keyof Seed, Record<string, unknown>>> = {
  users: { name: 'hijacked' },
  machines: { name: 'hijacked' },
  tools: { type: 'hijacked' },
  materials: { name: 'hijacked' },
  templates: { name: 'hijacked' },
  offcuts: { status: 'used' },
};

const RESOURCES = Object.keys(PATCHES).concat([
  'machineProfileVersions',
  'templateVersions',
  'projects',
  'projectCommands',
  'exports',
  'validations',
  'chatMessages',
  'aiUsage',
]) as (keyof Seed)[];

interface GenericResource {
  list(): Promise<{ id: string; companyId: string }[]>;
  get(id: string): Promise<{ id: string } | null>;
  update?: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
}

let h: DbHandle;
let a: CompanyScope;
let b: CompanyScope;
let seedA: Seed;
let seedB: Seed;

beforeAll(async () => {
  h = await openTestDb();
  a = forCompany(h.db, (await newCompany(h, 'A')).id);
  b = forCompany(h.db, (await newCompany(h, 'B')).id);
  seedA = await seed(a);
  seedB = await seed(b);
});
afterAll(async () => {
  await h.close();
});

const res = (scope: CompanyScope, key: keyof Seed) => scope[key] as unknown as GenericResource;

describe('tenant isolation', () => {
  it('covers every tenant table', () => {
    expect(RESOURCES).toHaveLength(Object.keys(tenantTables).length);
  });

  describe.each(RESOURCES)('%s', (key) => {
    it('list returns only own rows', async () => {
      const rowsA = await res(a, key).list();
      expect(rowsA.map((r) => r.id)).toContain(seedA[key].id);
      expect(rowsA.map((r) => r.id)).not.toContain(seedB[key].id);
      expect(rowsA.every((r) => r.companyId === a.companyId)).toBe(true);
    });

    it("get of another company's row returns null", async () => {
      expect(await res(a, key).get(seedB[key].id)).toBeNull();
      expect(await res(a, key).get(seedA[key].id)).not.toBeNull();
    });

    it("cannot update another company's row", async () => {
      const r = res(a, key);
      const patch = PATCHES[key];
      const update = r.update;
      if (!patch || !update) {
        // Append-only or specialised resources expose no generic update at all.
        expect(r.update).toBeUndefined();
        return;
      }
      expect(await update(seedB[key].id, patch)).toBeNull();
      const stillB = (await res(b, key).get(seedB[key].id)) as Record<string, unknown>;
      for (const [field, value] of Object.entries(patch)) expect(stillB[field]).not.toBe(value);
      // A caller-supplied company_id is ignored: the row stays in its company.
      const own = (await update(seedA[key].id, { companyId: b.companyId })) as {
        companyId: string;
      };
      expect(own.companyId).toBe(a.companyId);
    });
  });

  it("projects.save cannot write another company's project", async () => {
    await expect(
      a.projects.save(seedB.projects.id, {
        revision: seedB.projects.revision,
        data: seedB.projects.data,
      }),
    ).rejects.toThrow(/not found/);
    expect((await b.projects.get(seedB.projects.id))?.revision).toBe(seedB.projects.revision);
  });

  it("listCommands of another company's project is empty", async () => {
    expect(await a.projects.listCommands(seedB.projects.id)).toEqual([]);
  });

  it("cannot add versions to another company's machine or template", async () => {
    await expect(
      a.machines.addProfileVersion(seedB.machines.id, {
        profile: {},
        postConfig: {},
        postVersion: '1',
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      a.templates.addVersion(seedB.templates.id, { params: {}, geometry: {} }),
    ).rejects.toThrow(/not found/);
    expect(await a.machines.listProfileVersions(seedB.machines.id)).toEqual([]);
    expect(await a.templates.listVersions(seedB.templates.id)).toEqual([]);
  });

  it("template library helpers (T147) only see the company's own templates", async () => {
    expect(await a.templates.getVersion(seedB.templates.id, 1)).toBeNull();
    const own = await a.templates.createWithVersion('Menteşe A', {
      params: { count: 1 },
      geometry: {},
    });
    expect(own.version.version).toBe(1);
    expect(own.template.companyId).toBe(own.version.companyId);
    const listA = await a.templates.listLatest();
    const listB = await b.templates.listLatest();
    expect(listA.map((x) => x.template.id)).toContain(own.template.id);
    expect(listA.map((x) => x.template.id)).not.toContain(seedB.templates.id);
    expect(listB.map((x) => x.template.id)).not.toContain(own.template.id);
    expect(await b.templates.getVersion(own.template.id, 1)).toBeNull();
    expect((await a.templates.getVersion(own.template.id, 1))?.params).toEqual({ count: 1 });
  });

  it("composite FKs reject rows that point at another company's rows", async () => {
    await expect(
      a.tools.create({ machineId: seedB.machines.id, number: 9, type: 'flat', diameter: 6 }),
    ).rejects.toThrow();
    await expect(
      a.chatMessages.create({ projectId: seedB.projects.id, role: 'user', content: 'x' }),
    ).rejects.toThrow();
    await expect(
      a.exports.create({
        projectId: seedA.projects.id,
        projectRevision: 1,
        machineProfileVersionId: seedB.machineProfileVersions.id,
        postId: 'generic',
        postVersion: '1',
        kind: 'nc',
        unverified: false,
        fileKey: 'k',
        sha256: 'x',
        validationStage: 'draft',
      }),
    ).rejects.toThrow();
    await expect(
      a.validations.create({
        machineProfileVersionId: seedA.machineProfileVersions.id,
        toolSet: [],
        postVersion: '1',
        stage: 'draft',
        approvedBy: seedB.users.id,
      }),
    ).rejects.toThrow();
  });

  it('a caller-supplied companyId on create is overwritten', async () => {
    const row = await a.materials.create({
      name: 'smuggle',
      kind: 'mdf',
      thicknesses: [18],
      tone: 'natural',
      grain: null,
      sheetSizes: [{ width: 2440, height: 1220 }],
      companyId: b.companyId,
    });
    expect(row.companyId).toBe(a.companyId);
    expect((await b.materials.list()).map((m) => m.id)).not.toContain(row.id);
  });

  it('company scope sees and updates only its own company', async () => {
    expect((await a.company.get())?.id).toBe(a.companyId);
    await a.company.update({ plan: 'pro' });
    expect((await b.company.get())?.plan).not.toBe('pro');
  });

  it('ai usage counters are per company and accumulate', async () => {
    const again = await a.aiUsage.record('2026-11-01', { requests: 2, outputTokens: 5 });
    expect(again).toMatchObject({ requests: 3, inputTokens: 10, outputTokens: 5 });
    expect((await b.aiUsage.list())[0]).toMatchObject({ requests: 1, inputTokens: 10 });
  });
});
