/**
 * drizzle-kit config (D-014). `db:generate` needs no database. `db:migrate` uses
 * `DATABASE_URL` when set, otherwise the PGlite directory `PGLITE_DIR` or `<repo>/.data/pglite`
 * (D-004), the same default as `createDb()`.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

function pgliteDir(): string {
  const dir =
    process.env.PGLITE_DIR ?? fileURLToPath(new URL('../../.data/pglite', import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  ...(url ? { dbCredentials: { url } } : { driver: 'pglite', dbCredentials: { url: pgliteDir() } }),
});
