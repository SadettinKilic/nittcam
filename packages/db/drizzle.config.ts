/**
 * drizzle-kit config (D-014). `db:generate` needs no database. `db:migrate` uses
 * `DATABASE_URL` when set, otherwise the PGlite directory `.data/pglite` (D-004).
 */
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  ...(url
    ? { dbCredentials: { url } }
    : { driver: 'pglite', dbCredentials: { url: process.env.PGLITE_DIR ?? '../../.data/pglite' } }),
});
