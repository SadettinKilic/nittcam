/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known rows */
/**
 * Tester (B5, T112): projects saved by a v1 build are read back as schema v2 on every read path
 * (get, list, createOnce on an existing id) in PGlite, the mapping is checked against the RAW
 * stored JSON, a re-save stores v2, and an old v1 command log (grainLock params) still replays.
 */
import { CommandStack, type Project } from '@nittcam/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { projects } from '../schema';
import { forCompany, toCommandLogEntry, type CompanyScope } from '../tenant';
import { AT, FIXTURES, loadFixture, newCompany, openTestDb } from './helpers';

type Json = Record<string, unknown>;

let h: DbHandle;
let scope: CompanyScope;
let other: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  scope = forCompany(h.db, (await newCompany(h)).id);
  other = forCompany(h.db, (await newCompany(h, 'Other')).id);
});
afterAll(async () => {
  await h.close();
});

/** Stores raw v1 JSON past validation, as an older build left it. */
async function storeRawV1(name: (typeof FIXTURES)[number]): Promise<{ id: string; v1: Json }> {
  const v1 = loadFixture(name) as Json;
  const created = await scope.projects.create({ name, data: v1 });
  await h.db
    .update(projects)
    .set({ data: v1 as never })
    .where(eq(projects.id, created.id));
  const raw = await h.db.select().from(projects).where(eq(projects.id, created.id));
  expect((raw[0]!.data as Json)['schemaVersion']).toBe(1);
  return { id: created.id, v1 };
}

function expectMapped(data: Project, v1: Json): void {
  expect(data.schemaVersion).toBe(2);
  const sheet = (v1['stock'] as Json)['sheet'] as Json;
  expect(data.stock.sheet.grain).toBe(sheet['grain']);
  const rawParts = v1['parts'] as Json[];
  expect(data.parts.map((p) => p.id)).toEqual(rawParts.map((p) => p['id']));
  rawParts.forEach((rp, i) => {
    expect(data.parts[i]!.grain).toEqual(
      rp['grainLock'] ? { mode: 'fixed', angle: sheet['grain'] } : { mode: 'free', angle: 0 },
    );
    expect('grainLock' in data.parts[i]!).toBe(false);
  });
  expect(data.layout).toEqual(v1['layout']);
}

describe('v1 rows in PGlite read as v2 (tester)', () => {
  it.each(FIXTURES)(
    '%s: get, list and createOnce all upgrade; raw grainLock mapped',
    async (name) => {
      const { id, v1 } = await storeRawV1(name);
      const got = await scope.projects.get(id);
      expectMapped(got!.data, v1);
      const listed = (await scope.projects.list()).find((r) => r.id === id);
      expectMapped(listed!.data, v1);
      const once = await scope.projects.createOnce({ id, name, data: loadFixture(name) });
      expect(once.created).toBe(false);
      expectMapped(once.row.data, v1);
      // Another company never sees it, upgraded or not.
      expect(await other.projects.get(id)).toBeNull();
    },
  );

  it.each(FIXTURES)('%s: re-saving the upgraded project stores schema v2', async (name) => {
    const { id } = await storeRawV1(name);
    const got = (await scope.projects.get(id))!;
    const saved = await scope.projects.save(id, { revision: got.revision, data: got.data });
    expect(saved.revision).toBe(got.revision + 1);
    const raw = await h.db.select().from(projects).where(eq(projects.id, id));
    const stored = raw[0]!.data as Json;
    expect(stored['schemaVersion']).toBe(2);
    for (const p of stored['parts'] as Json[]) {
      expect('grainLock' in p).toBe(false);
      expect(p['grain']).toBeDefined();
    }
  });

  it('an old command log with grainLock params replays onto the upgraded project', async () => {
    const { id } = await storeRawV1('mixed');
    const got = (await scope.projects.get(id))!;
    // v1-era parsed params: grainLock (with defaults), as stored in project_commands.
    const v1Log = [
      { command: 'setGrain', params: { grain: 90 }, actor: 'user' as const, at: AT },
      {
        command: 'addPart',
        params: {
          id: 'legacy',
          name: '',
          qty: 1,
          grainLock: true,
          params: { w: 400, h: 300, r: 0 },
          edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        actor: 'ai' as const,
        at: AT,
      },
      {
        command: 'updatePart',
        params: { id: got.data.parts[0]!.id, grainLock: true },
        actor: 'user' as const,
        at: AT,
      },
    ];
    const saved = await scope.projects.save(id, {
      revision: got.revision,
      data: got.data,
      commands: v1Log,
    });
    const entries = (await scope.projects.listCommands(id)).map(toCommandLogEntry);
    const replay = new CommandStack(saved.data);
    for (const e of entries) {
      expect(replay.execute(e.command, e.params, { actor: e.actor, at: e.at }).ok).toBe(true);
    }
    const legacy = replay.project.parts.find((p) => p.id === 'legacy')!;
    expect(legacy.grain).toEqual({ mode: 'fixed', angle: 90 });
    expect(replay.project.parts[0]!.grain).toEqual({ mode: 'fixed', angle: 90 });
  });
});
