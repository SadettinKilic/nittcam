/**
 * Tester (B72, T356, D-138): migration 0016 on a database that already holds verifications. A
 * database migrated up to 0015 gets verifications (raw rows, as a pre-T356 build wrote them); after
 * 0016 every old record is the wood board family, the machine keeps its state, the ACM family
 * starts as draft, and an unknown family is refused by the check constraint.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultMachineProfile } from '@nittcam/core';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, MIGRATIONS_DIR } from '../client';
import { companies } from '../index';
import { forCompany } from '../tenant';

const work = mkdtempSync(join(tmpdir(), 'nittcam-m0016-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The migrations folder without its last entry (0016). */
function before0016(): string {
  const dir = join(work, 'migrations-0015');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.at(-1);
  expect(last?.tag).toMatch(/^0016_/);
  journal.entries = journal.entries.slice(0, -1);
  writeFileSync(journalPath, JSON.stringify(journal));
  rmSync(join(dir, `${last?.tag}.sql`));
  return dir;
}

// `url: ''` keeps this on its own PGlite copy even when DATABASE_URL points at the CI Postgres
// (that one is already migrated to the latest, so the pre-0016 state cannot be built there).
describe('migration 0016 on an existing database (tester)', () => {
  it('old verifications stay the wood board state; ACM draft; unknown family refused', async () => {
    const data = join(work, 'pglite');
    const old = await createDb({ url: '', pglite: data, migrationsFolder: before0016() });
    await old.migrate();
    const company = await companies.create(old.db, { name: `M0016 ${randomUUID().slice(0, 6)}` });
    const scope = forCompany(old.db, company.id);
    const profile = defaultMachineProfile();
    profile.identity.name = 'Eski makine';
    const verified = await scope.machines.createWithProfile(profile);
    profile.identity.name = 'Hava kesimi yapılmış';
    const air = await scope.machines.createWithProfile(profile);
    const insert = (versionId: string, stage: string, at: string) =>
      old.db.execute(sql`insert into validations
        (company_id, machine_profile_version_id, tool_set, post_version, stage, created_at)
        values (${company.id}, ${versionId}, '[]'::jsonb, 'mach3@1', ${stage}::validation_stage, ${at}::timestamptz)`);
    await insert(verified.version.id, 'air_cut_approved', '2026-11-01T10:00:00Z');
    await insert(verified.version.id, 'verified', '2026-11-02T10:00:00Z');
    await insert(air.version.id, 'air_cut_approved', '2026-11-03T10:00:00Z');
    const cols = await old.db.execute(
      sql`select column_name from information_schema.columns where table_name = 'validations'`,
    );
    expect(JSON.stringify(cols)).not.toContain('material_family');
    await old.close();

    const now = await createDb({ url: '', pglite: data });
    await now.migrate();
    try {
      const s = forCompany(now.db, company.id);
      const v = await s.machines.getWithProfile(verified.machine.id);
      expect(v?.state).toBe('verified');
      expect(v?.families.woodBoard).toBe('verified');
      expect(v?.families.composite).toBe('draft');
      const a = await s.machines.getWithProfile(air.machine.id);
      expect(a?.state).toBe('air_cut_approved');
      expect(a?.families.composite).toBe('draft');
      // The list path reads the same states.
      const list = await s.machines.listWithProfiles();
      expect(list.find((m) => m.machine.id === verified.machine.id)?.state).toBe('verified');
      // The check constraint refuses an unknown family.
      await expect(
        now.db.execute(sql`insert into validations
          (company_id, machine_profile_version_id, tool_set, post_version, stage, material_family)
          values (${company.id}, ${verified.version.id}, '[]'::jsonb, 'mach3@1', 'verified', 'wood')`),
      ).rejects.toThrow();
    } finally {
      await now.close();
    }
  });
});
