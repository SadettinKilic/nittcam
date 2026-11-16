/**
 * Database connection (D-004, D-014). PGlite (in-process Postgres) by default; a real Postgres
 * through `pg` when `DATABASE_URL` is set. Both expose the same Drizzle `PgDatabase` API.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
/** Driver-independent Drizzle database. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** Default PGlite directory for local dev: `<repo>/.data/pglite` (gitignored). */
export const DEFAULT_PGLITE_DIR = fileURLToPath(new URL('../../../.data/pglite', import.meta.url));

export interface CreateDbOptions {
  /** Postgres URL. Defaults to `process.env.DATABASE_URL`. When set, PGlite is not used. */
  url?: string | undefined;
  /**
   * PGlite data location when no URL is given: `'memory'` (tests) or a directory.
   * Defaults to `process.env.PGLITE_DIR` or `<repo>/.data/pglite`.
   */
  pglite?: 'memory' | (string & {}) | undefined;
}

export interface DbHandle {
  db: Db;
  driver: 'pglite' | 'postgres';
  /** Applies all pending migrations from `packages/db/migrations` (forward only). */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** Absolute path of the generated migrations folder. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Opens the database. Call `migrate()` on the handle before first use of a fresh database. */
export async function createDb(options: CreateDbOptions = {}): Promise<DbHandle> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg({ client: pool, schema });
    return {
      db: db as unknown as Db,
      driver: 'postgres',
      migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => pool.end(),
    };
  }

  const location = options.pglite ?? process.env.PGLITE_DIR ?? DEFAULT_PGLITE_DIR;
  let client: PGlite;
  if (location === 'memory') {
    client = await PGlite.create();
  } else {
    mkdirSync(location, { recursive: true });
    client = await PGlite.create(location);
  }
  const db = drizzlePglite({ client, schema });
  return {
    db: db as unknown as Db,
    driver: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close(),
  };
}
