import { CommandStack, parseProject, type CommandLogEntry, type Project } from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../client';
import { projects } from '../schema';
import {
  forCompany,
  InvalidProject,
  RevisionConflict,
  toCommandLogEntry,
  type CompanyScope,
} from '../tenant';
import { AT, FIXTURES, loadFixture, newCompany, openTestDb } from './helpers';

let h: DbHandle;
let scope: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  scope = forCompany(h.db, (await newCompany(h)).id);
});
afterAll(async () => {
  await h.close();
});

function parsed(json: unknown): Project {
  const r = parseProject(json);
  if (!r.ok) throw new Error('fixture does not parse');
  return r.project;
}

describe('projects jsonb', () => {
  it.each(FIXTURES)('%s round-trips through jsonb and parseProject', async (name) => {
    const fixture = loadFixture(name);
    const created = await scope.projects.create({ name, data: fixture });
    const loaded = await scope.projects.get(created.id);
    if (!loaded) throw new Error('project not found');
    const again = parseProject(loaded.data);
    expect(again.ok).toBe(true);
    expect(again.ok && again.project).toEqual(parsed(fixture));
    expect(loaded.revision).toBe(1);
    expect(loaded.status).toBe('draft');
  });

  it('a stored v1 row reads back as schema v2 (D-034 migration on read)', async () => {
    const v1 = JSON.parse(JSON.stringify(loadFixture('cabinet-doors'))) as Record<string, unknown>;
    const created = await scope.projects.create({ name: 'v1', data: v1 });
    // Simulate a row saved by an older build: write the raw v1 JSON past validation.
    await h.db
      .update(projects)
      .set({ data: v1 as never })
      .where(eq(projects.id, created.id));
    const loaded = await scope.projects.get(created.id);
    expect(loaded?.data.schemaVersion).toBe(2);
    expect(loaded?.data.parts.every((p) => p.grain !== undefined)).toBe(true);
    expect(loaded?.data).toEqual(parsed(v1));
    const listed = (await scope.projects.list()).find((r) => r.id === created.id);
    expect(listed?.data).toEqual(parsed(v1));
  });

  it('rejects invalid project JSON and writes nothing', async () => {
    const before = (await scope.projects.list()).length;
    await expect(
      scope.projects.create({ name: 'bad', data: { schemaVersion: 1 } }),
    ).rejects.toBeInstanceOf(InvalidProject);
    expect(await scope.projects.list()).toHaveLength(before);
  });
});

describe('revision lock', () => {
  it('increments on save and rejects a stale revision with RevisionConflict', async () => {
    const p = await scope.projects.create({ name: 'lock', data: loadFixture('mixed') });
    const data = parsed(loadFixture('mixed'));

    const s1 = await scope.projects.save(p.id, {
      revision: 1,
      data: { ...data, stock: { ...data.stock, thickness: 16 } },
      status: 'produced',
    });
    expect(s1.revision).toBe(2);
    expect(s1.status).toBe('produced');
    expect(s1.data.stock.thickness).toBe(16);

    // A second client still holds revision 1.
    const stale = scope.projects.save(p.id, {
      revision: 1,
      data: { ...data, stock: { ...data.stock, thickness: 25 } },
      commands: [{ command: 'setThickness', params: { thickness: 25 }, actor: 'user', at: AT }],
    });
    await expect(stale).rejects.toBeInstanceOf(RevisionConflict);
    await expect(stale).rejects.toMatchObject({ expectedRevision: 1, actualRevision: 2 });

    const current = await scope.projects.get(p.id);
    expect(current?.revision).toBe(2);
    expect(current?.data.stock.thickness).toBe(16);
    // The rejected save stored no commands (same transaction).
    expect(await scope.projects.listCommands(p.id)).toEqual([]);

    const s2 = await scope.projects.save(p.id, { revision: 2, data: s1.data });
    expect(s2.revision).toBe(3);
  });

  it('T326: a repeated save (same saveId) answers again and writes nothing twice', async () => {
    const p = await scope.projects.create({ name: 'repeat', data: loadFixture('mixed') });
    const data = parsed(loadFixture('mixed'));
    const S1 = '11111111-1111-4111-8111-111111111111';
    const S2 = '22222222-2222-4222-8222-222222222222';
    const cmd: CommandLogEntry[] = [
      { command: 'setThickness', params: { thickness: 16 }, actor: 'user', at: AT },
    ];
    const req = {
      revision: 1,
      data: { ...data, stock: { ...data.stock, thickness: 16 } },
      commands: cmd,
      saveId: S1,
    };
    const first = await scope.projects.save(p.id, req);
    expect(first.revision).toBe(2);
    expect(first.lastSaveId).toBe(S1);
    // The same request again (its answer was lost): the stored row, no second command row.
    const again = await scope.projects.save(p.id, req);
    expect(again.revision).toBe(2);
    expect(await scope.projects.listCommands(p.id)).toHaveLength(1);
    // Another save id on the same base is a real conflict.
    await expect(scope.projects.save(p.id, { ...req, saveId: S2 })).rejects.toBeInstanceOf(
      RevisionConflict,
    );
    // So is a save without an id (older client).
    const { saveId: _omit, ...noId } = req;
    void _omit;
    await expect(scope.projects.save(p.id, noId)).rejects.toBeInstanceOf(RevisionConflict);
    // Once a later save moved the revision on, the old id is a conflict again.
    await scope.projects.save(p.id, { revision: 2, data: first.data, saveId: S2 });
    await expect(scope.projects.save(p.id, req)).rejects.toBeInstanceOf(RevisionConflict);
    expect(await scope.projects.listCommands(p.id)).toHaveLength(1);
  });

  it('T326: createOnce keeps the save id of the create', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const S1 = '44444444-4444-4444-8444-444444444444';
    const r = await scope.projects.createOnce({
      id,
      name: 'new',
      data: loadFixture('mixed'),
      saveId: S1,
    });
    expect(r.created).toBe(true);
    expect(r.row.lastSaveId).toBe(S1);
    const again = await scope.projects.createOnce({ id, name: 'new', data: loadFixture('mixed') });
    expect(again.created).toBe(false);
    expect(again.row.lastSaveId).toBe(S1);
  });

  it('rejects an invalid project on save without touching the revision', async () => {
    const p = await scope.projects.create({ name: 'inv', data: loadFixture('shelf-set') });
    await expect(
      scope.projects.save(p.id, { revision: 1, data: { nope: true } }),
    ).rejects.toBeInstanceOf(InvalidProject);
    expect((await scope.projects.get(p.id))?.revision).toBe(1);
  });
});

describe('project_commands', () => {
  it('stores the T005 command log shape and returns it in order', async () => {
    const p = await scope.projects.create({ name: 'log', data: loadFixture('shelf-set') });
    const user = await scope.users.create({ email: `log-${scope.companyId}@example.com` });

    const stack = new CommandStack(p.data);
    const r1 = stack.execute('setThickness', { thickness: 16 }, { actor: 'user', at: AT });
    const r2 = stack.execute(
      'addPart',
      { id: 'extra', params: { w: 100, h: 200, r: 0 } },
      { actor: 'ai', at: '2026-11-16T13:00:05.250+03:00' },
    );
    expect(r1.ok && r2.ok).toBe(true);

    const saved = await scope.projects.save(p.id, {
      revision: p.revision,
      data: stack.project,
      commands: stack.log,
      userId: user.id,
    });
    const rows = await scope.projects.listCommands(p.id);
    expect(rows.map((r) => [r.revision, r.seq, r.userId])).toEqual([
      [saved.revision, 0, user.id],
      [saved.revision, 1, user.id],
    ]);
    const entries = rows.map(toCommandLogEntry);
    // `at` comes back as the same instant in UTC.
    expect(entries).toEqual(stack.log.map((e) => ({ ...e, at: new Date(e.at).toISOString() })));
    // Parsed params (with defaults) are stored, so the log replays to the saved project.
    const replay = new CommandStack(p.data);
    for (const e of entries) {
      expect(replay.execute(e.command, e.params, { actor: e.actor, at: e.at }).ok).toBe(true);
    }
    expect(replay.project).toEqual(saved.data);
  });
});

describe('create with commands (T023)', () => {
  it('stores the commands of a new project under revision 1, in the same transaction', async () => {
    const p = await scope.projects.create({
      name: 'new',
      data: loadFixture('mixed'),
      commands: [
        { command: 'setThickness', params: { thickness: 18 }, actor: 'user', at: AT },
        { command: 'undo', params: {}, actor: 'user', at: AT },
      ],
    });
    const rows = await scope.projects.listCommands(p.id);
    expect(rows.map((r) => [r.revision, r.seq, r.command])).toEqual([
      [1, 0, 'setThickness'],
      [1, 1, 'undo'],
    ]);
  });

  it('writes nothing when the project is invalid', async () => {
    const before = (await scope.projects.list()).length;
    await expect(
      scope.projects.create({
        name: 'bad',
        data: { nope: 1 },
        commands: [{ command: 'setThickness', params: { thickness: 18 }, actor: 'user', at: AT }],
      }),
    ).rejects.toBeInstanceOf(InvalidProject);
    expect(await scope.projects.list()).toHaveLength(before);
  });
});
