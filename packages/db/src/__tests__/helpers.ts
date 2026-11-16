/**
 * Test helpers. PGlite in memory by default; with `DATABASE_URL` set (CI postgres job) the same
 * tests run against a real Postgres, where every test creates its own companies.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDb, type DbHandle } from '../client';
import { companies } from '../tenant';

export async function openTestDb(): Promise<DbHandle> {
  const handle = await createDb({ pglite: 'memory' });
  await handle.migrate();
  return handle;
}

export async function newCompany(handle: DbHandle, name = 'Test') {
  return companies.create(handle.db, { name: `${name} ${randomUUID().slice(0, 8)}` });
}

export const FIXTURES = ['shelf-set', 'cabinet-doors', 'mixed'] as const;

export function loadFixture(name: (typeof FIXTURES)[number]): unknown {
  const url = new URL(`../../../core/src/schema/__fixtures__/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

export const AT = '2026-11-16T10:00:00.000Z';
