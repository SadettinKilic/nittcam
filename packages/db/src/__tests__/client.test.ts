import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../client';
import { companies, forCompany } from '../tenant';

describe('createDb', () => {
  it.skipIf(Boolean(process.env.DATABASE_URL))(
    'file-backed PGlite (dev mode) keeps data across reopen',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'nittcam-pglite-'));
      try {
        const first = await createDb({ url: '', pglite: join(dir, 'db') });
        expect(first.driver).toBe('pglite');
        await first.migrate();
        const c = await companies.create(first.db, { name: 'Persist' });
        await forCompany(first.db, c.id).machines.create({ name: 'M' });
        await first.close();

        const second = await createDb({ url: '', pglite: join(dir, 'db') });
        await second.migrate(); // already applied: no-op
        expect((await forCompany(second.db, c.id).machines.list()).map((m) => m.name)).toEqual([
          'M',
        ]);
        await second.close();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(Boolean(process.env.DATABASE_URL))(
    'uses postgres when DATABASE_URL is set',
    async () => {
      const h = await createDb();
      expect(h.driver).toBe('postgres');
      await h.close();
    },
  );
});
