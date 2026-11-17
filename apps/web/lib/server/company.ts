/**
 * Server-side database access for route handlers (D-016). One database handle per server process
 * (PGlite file DB in dev, Postgres when `DATABASE_URL` is set), migrated on first use.
 *
 * Single user for now: every request works in one default company, created and seeded with the
 * example machine on first use. Auth (T023) replaces `companyScope()` with the session's company.
 */
import { join } from 'node:path';
import {
  companies,
  createDb,
  forCompany,
  seedDefaultProfile,
  upgradeExampleProfile,
  type CompanyScope,
  type DbHandle,
} from '@nittcam/db';

/** Fixed id of the single-user company until T023. */
export const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_COMPANY_NAME = 'Atölyem';

const cache = globalThis as typeof globalThis & {
  nittcamDb?: Promise<DbHandle>;
  nittcamScope?: Promise<CompanyScope>;
};

/**
 * The server runs with the web app folder as working directory (`pnpm --filter @nittcam/web`),
 * so repo paths are resolved from there; inside the bundle the db package cannot find them itself.
 */
const REPO_ROOT = join(/* turbopackIgnore: true */ process.cwd(), '..', '..');

async function openDb(): Promise<DbHandle> {
  const handle = await createDb({
    pglite: process.env.PGLITE_DIR ?? join(REPO_ROOT, '.data', 'pglite'),
    migrationsFolder: join(REPO_ROOT, 'packages', 'db', 'migrations'),
  });
  await handle.migrate();
  return handle;
}

async function openScope(): Promise<CompanyScope> {
  cache.nittcamDb ??= openDb();
  const { db } = await cache.nittcamDb;
  const { company, created } = await companies.ensure(db, DEFAULT_COMPANY_ID, {
    name: DEFAULT_COMPANY_NAME,
  });
  const scope = forCompany(db, company.id);
  if (created) await seedDefaultProfile(scope);
  // Companies seeded before T020: replace an untouched old example by a new version (D-028).
  else await upgradeExampleProfile(scope);
  return scope;
}

/** The tenant-scoped repository of the current (default) company. */
export function companyScope(): Promise<CompanyScope> {
  cache.nittcamScope ??= openScope().catch((err: unknown) => {
    // Let the next request retry instead of caching the failure.
    delete cache.nittcamDb;
    delete cache.nittcamScope;
    throw err;
  });
  return cache.nittcamScope;
}
