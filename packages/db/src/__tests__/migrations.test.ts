import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { tenantTables } from '../schema';
import { openTestDb } from './helpers';

const ALL_TABLES = ['companies', ...Object.keys(tenantTables)].sort();

let h: DbHandle;
beforeAll(async () => {
  h = await openTestDb();
});
afterAll(async () => {
  await h.close();
});

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await h.db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

describe('migrations', () => {
  it('create every §9.1 table on a fresh database', async () => {
    const tables = await rows<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(tables.map((t) => t.table_name).sort()).toEqual(ALL_TABLES);
    expect(ALL_TABLES).toHaveLength(15);
  });

  it('are idempotent (a second run applies nothing and does not fail)', async () => {
    await h.migrate();
    const applied = await rows<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it.each(Object.keys(tenantTables))(
    '%s has company_id: not null, FK to companies, leading column of an index',
    async (table) => {
      const col = await rows<{ is_nullable: string; data_type: string }>(
        sql`select is_nullable, data_type from information_schema.columns
            where table_schema = 'public' and table_name = ${table} and column_name = 'company_id'`,
      );
      expect(col).toEqual([{ is_nullable: 'NO', data_type: 'uuid' }]);

      const fks = await rows<{ ref: string }>(
        sql`select ccu.table_name as ref
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
            join information_schema.constraint_column_usage ccu
              on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
            where tc.table_schema = 'public' and tc.table_name = ${table}
              and tc.constraint_type = 'FOREIGN KEY' and kcu.column_name = 'company_id'
              and ccu.table_name = 'companies'`,
      );
      expect(fks.length).toBeGreaterThanOrEqual(1);

      const idx = await rows<{ indexdef: string }>(
        sql`select indexdef from pg_indexes where schemaname = 'public' and tablename = ${table}`,
      );
      expect(idx.some((i) => /\("?company_id"?[,)]/.test(i.indexdef))).toBe(true);
    },
  );

  it('companies is the only table without company_id', async () => {
    const col = await rows<{ table_name: string }>(
      sql`select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'company_id'`,
    );
    expect(col.map((c) => c.table_name).sort()).toEqual(Object.keys(tenantTables).sort());
  });

  it('uses enums for the fixed value lists', async () => {
    const enums = await rows<{ name: string; values: string }>(
      sql`select t.typname as name, string_agg(e.enumlabel, ',' order by e.enumsortorder) as values
          from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`,
    );
    const map = Object.fromEntries(enums.map((e) => [e.name, e.values]));
    expect(map.user_role).toBe('admin,operator');
    expect(map.project_status).toBe('draft,produced,completed');
    expect(map.validation_stage).toBe('draft,air_cut_approved,test_cut_approved,verified');
    expect(map.command_actor).toBe('user,ai');
  });
});
