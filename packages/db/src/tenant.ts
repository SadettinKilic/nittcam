/**
 * Tenant-scoped repository API (spec §8.6, D-014). `forCompany(db, companyId)` is the only way to
 * read or write tenant data: every query below filters by `company_id` inside the helper, and
 * every insert sets `company_id` itself (a caller-supplied value is overwritten). The only
 * company-agnostic query is `companies.create`.
 */
import { parseProject, type CommandLogEntry, type Project } from '@nittcam/core';
import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './client';
import {
  aiUsage,
  chatMessages,
  companies as companiesTable,
  exports as exportsTable,
  machineProfileVersions,
  machines as machinesTable,
  materials,
  offcuts,
  projectCommands,
  projects as projectsTable,
  templates as templatesTable,
  templateVersions,
  tools,
  users,
  validations,
  type tenantTables,
} from './schema';

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** A save carried a stale revision (HTTP 409 at the API layer). */
export class RevisionConflict extends Error {
  override readonly name = 'RevisionConflict';
  constructor(
    readonly projectId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `project ${projectId}: revision conflict (expected ${expectedRevision}, current ${actualRevision})`,
    );
  }
}

/** The row does not exist for this company (another company's row looks the same). */
export class NotFound extends Error {
  override readonly name = 'NotFound';
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} ${id} not found`);
  }
}

/** The project JSON failed core `parseProject`; nothing was written. */
export class InvalidProject extends Error {
  override readonly name = 'InvalidProject';
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`invalid project: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Generic scoped CRUD
// ---------------------------------------------------------------------------------------------

type TenantTable = (typeof tenantTables)[keyof typeof tenantTables];
type Row<T extends TenantTable> = T['$inferSelect'];
/** Insert values: the helper owns `id`, `company_id` and the timestamps. */
export type NewRow<T extends TenantTable> = Omit<
  T['$inferInsert'],
  'id' | 'companyId' | 'createdAt' | 'updatedAt'
>;
export type RowPatch<T extends TenantTable> = Partial<NewRow<T>>;

/** Read access to one tenant table. */
export interface ScopedReader<R> {
  list(): Promise<R[]>;
  /** `null` when the row does not exist or belongs to another company. */
  get(id: string): Promise<R | null>;
}
/** Append-only table: create, never update. */
export interface ScopedAppendOnly<R, N> extends ScopedReader<R> {
  create(values: N): Promise<R>;
}
/** Mutable table. */
export interface ScopedMutable<R, N> extends ScopedAppendOnly<R, N> {
  /** `null` when the row does not exist or belongs to another company (nothing is changed). */
  update(id: string, patch: Partial<N>): Promise<R | null>;
}

interface TenantColumns {
  id: PgColumn;
  companyId: PgColumn;
}

/** Removes keys the helper owns, so a caller cannot move a row to another company. */
function stripOwned(values: object): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...values };
  delete rest.id;
  delete rest.companyId;
  delete rest.createdAt;
  delete rest.updatedAt;
  return rest;
}

function reader<T extends TenantTable>(db: Db, companyId: string, table: T): ScopedReader<Row<T>> {
  const t = table as unknown as PgTable & TenantColumns;
  return {
    async list() {
      const rows = await db.select().from(t).where(eq(t.companyId, companyId));
      return rows as Row<T>[];
    },
    async get(id) {
      const rows = await db
        .select()
        .from(t)
        .where(and(eq(t.id, id), eq(t.companyId, companyId)));
      return (rows[0] as Row<T> | undefined) ?? null;
    },
  };
}

function appendOnly<T extends TenantTable>(
  db: Db,
  companyId: string,
  table: T,
): ScopedAppendOnly<Row<T>, NewRow<T>> {
  const t = table as unknown as PgTable & TenantColumns;
  return {
    ...reader(db, companyId, table),
    async create(values) {
      const rows = await db
        .insert(t)
        .values({ ...stripOwned(values), companyId } as never)
        .returning();
      return rows[0] as Row<T>;
    },
  };
}

function mutable<T extends TenantTable>(
  db: Db,
  companyId: string,
  table: T,
): ScopedMutable<Row<T>, NewRow<T>> {
  const t = table as unknown as PgTable & TenantColumns;
  return {
    ...appendOnly(db, companyId, table),
    async update(id, patch) {
      const rows = await db
        .update(t)
        .set({ ...stripOwned(patch), updatedAt: new Date() } as never)
        .where(and(eq(t.id, id), eq(t.companyId, companyId)))
        .returning();
      return (rows[0] as Row<T> | undefined) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Companies (the only unscoped entry point)
// ---------------------------------------------------------------------------------------------

export type Company = typeof companiesTable.$inferSelect;
export type NewCompany = Omit<typeof companiesTable.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;

export const companies = {
  /** Creates a tenant. Sign-up flow only; everything else goes through `forCompany`. */
  async create(db: Db, values: NewCompany): Promise<Company> {
    const rows = await db
      .insert(companiesTable)
      .values(stripOwned(values) as NewCompany)
      .returning();
    return rows[0] as Company;
  },
};

// ---------------------------------------------------------------------------------------------
// Specialised repositories
// ---------------------------------------------------------------------------------------------

export type ProjectRow = typeof projectsTable.$inferSelect;
export type ProjectCommandRow = typeof projectCommands.$inferSelect;
export type MachineRow = typeof machinesTable.$inferSelect;
export type MachineProfileVersionRow = typeof machineProfileVersions.$inferSelect;
export type TemplateVersionRow = typeof templateVersions.$inferSelect;

/**
 * Converts a stored command row back to the core log shape. `at` is returned as UTC ISO 8601
 * (`timestamptz` keeps the instant, not the client's offset).
 */
export function toCommandLogEntry(row: ProjectCommandRow): CommandLogEntry {
  return {
    command: row.command,
    params: row.params,
    actor: row.actor,
    at: row.at.toISOString(),
  };
}

function validProject(data: unknown): Project {
  const result = parseProject(data);
  if (!result.ok) throw new InvalidProject(result.issues);
  return result.project;
}

export interface NewProject {
  name: string;
  status?: ProjectRow['status'];
  /** Raw project JSON; validated (and migrated) with core `parseProject`. */
  data: unknown;
}

export interface SaveProject {
  /** The revision the client last loaded. A different current revision throws `RevisionConflict`. */
  revision: number;
  data: unknown;
  name?: string;
  status?: ProjectRow['status'];
  /** Commands applied since `revision`; stored in `project_commands` under the new revision. */
  commands?: readonly CommandLogEntry[];
  /** User who saved (same company); stored on the command rows. */
  userId?: string;
}

function projectsRepo(db: Db, companyId: string) {
  const base = reader(db, companyId, projectsTable);
  const scope = (id: string) =>
    and(eq(projectsTable.id, id), eq(projectsTable.companyId, companyId));
  return {
    ...base,
    async list() {
      return db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.companyId, companyId))
        .orderBy(desc(projectsTable.updatedAt));
    },
    async create(values: NewProject): Promise<ProjectRow> {
      const data = validProject(values.data);
      const rows = await db
        .insert(projectsTable)
        .values({
          companyId,
          name: values.name,
          ...(values.status ? { status: values.status } : {}),
          data,
          revision: 1,
        })
        .returning();
      return rows[0] as ProjectRow;
    },
    /**
     * Optimistic save: succeeds only if the stored revision equals `input.revision`, then
     * increments it. The project row and its command rows are written in one transaction.
     */
    async save(id: string, input: SaveProject): Promise<ProjectRow> {
      const data = validProject(input.data);
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(projectsTable)
          .set({
            data,
            revision: sql`${projectsTable.revision} + 1`,
            updatedAt: new Date(),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          })
          .where(and(scope(id), eq(projectsTable.revision, input.revision)))
          .returning();
        const saved = rows[0];
        if (!saved) {
          const current = await tx
            .select({ revision: projectsTable.revision })
            .from(projectsTable)
            .where(scope(id));
          const found = current[0];
          if (!found) throw new NotFound('project', id);
          throw new RevisionConflict(id, input.revision, found.revision);
        }
        const commands = input.commands ?? [];
        if (commands.length > 0) {
          await tx.insert(projectCommands).values(
            commands.map((c, seq) => ({
              companyId,
              projectId: id,
              revision: saved.revision,
              seq,
              command: c.command,
              params: c.params,
              actor: c.actor,
              at: new Date(c.at),
              userId: input.userId ?? null,
            })),
          );
        }
        return saved;
      });
    },
    /** Command log of a project, oldest first. Empty for another company's project. */
    async listCommands(projectId: string): Promise<ProjectCommandRow[]> {
      return db
        .select()
        .from(projectCommands)
        .where(
          and(eq(projectCommands.projectId, projectId), eq(projectCommands.companyId, companyId)),
        )
        .orderBy(asc(projectCommands.revision), asc(projectCommands.seq));
    },
  };
}

export interface NewProfileVersion {
  profile: Record<string, unknown>;
  postConfig: Record<string, unknown>;
  postVersion: string;
}

function machinesRepo(db: Db, companyId: string) {
  return {
    ...mutable(db, companyId, machinesTable),
    /**
     * Profile edits never update a version row: they insert version `max + 1`. There is no
     * update function for versions. Concurrent adds for one machine: one wins, the other hits
     * the `(machine_id, version)` unique constraint and may retry.
     */
    async addProfileVersion(
      machineId: string,
      values: NewProfileVersion,
    ): Promise<MachineProfileVersionRow> {
      return db.transaction(async (tx) => {
        const owner = await tx
          .select({ id: machinesTable.id })
          .from(machinesTable)
          .where(and(eq(machinesTable.id, machineId), eq(machinesTable.companyId, companyId)));
        if (owner.length === 0) throw new NotFound('machine', machineId);
        const last = await tx
          .select({ v: max(machineProfileVersions.version) })
          .from(machineProfileVersions)
          .where(
            and(
              eq(machineProfileVersions.machineId, machineId),
              eq(machineProfileVersions.companyId, companyId),
            ),
          );
        const rows = await tx
          .insert(machineProfileVersions)
          .values({
            companyId,
            machineId,
            version: (last[0]?.v ?? 0) + 1,
            profile: values.profile,
            postConfig: values.postConfig,
            postVersion: values.postVersion,
          })
          .returning();
        return rows[0] as MachineProfileVersionRow;
      });
    },
    /** All versions of a machine, oldest first. */
    async listProfileVersions(machineId: string): Promise<MachineProfileVersionRow[]> {
      return db
        .select()
        .from(machineProfileVersions)
        .where(
          and(
            eq(machineProfileVersions.machineId, machineId),
            eq(machineProfileVersions.companyId, companyId),
          ),
        )
        .orderBy(asc(machineProfileVersions.version));
    },
  };
}

export interface NewTemplateVersion {
  params: Record<string, unknown>;
  geometry: Record<string, unknown>;
}

function templatesRepo(db: Db, companyId: string) {
  return {
    ...mutable(db, companyId, templatesTable),
    /** Same immutability rule as machine profile versions. */
    async addVersion(templateId: string, values: NewTemplateVersion): Promise<TemplateVersionRow> {
      return db.transaction(async (tx) => {
        const owner = await tx
          .select({ id: templatesTable.id })
          .from(templatesTable)
          .where(and(eq(templatesTable.id, templateId), eq(templatesTable.companyId, companyId)));
        if (owner.length === 0) throw new NotFound('template', templateId);
        const last = await tx
          .select({ v: max(templateVersions.version) })
          .from(templateVersions)
          .where(
            and(
              eq(templateVersions.templateId, templateId),
              eq(templateVersions.companyId, companyId),
            ),
          );
        const rows = await tx
          .insert(templateVersions)
          .values({
            companyId,
            templateId,
            version: (last[0]?.v ?? 0) + 1,
            params: values.params,
            geometry: values.geometry,
          })
          .returning();
        return rows[0] as TemplateVersionRow;
      });
    },
    async listVersions(templateId: string): Promise<TemplateVersionRow[]> {
      return db
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, templateId),
            eq(templateVersions.companyId, companyId),
          ),
        )
        .orderBy(asc(templateVersions.version));
    },
  };
}

export type AiUsageRow = typeof aiUsage.$inferSelect;

function aiUsageRepo(db: Db, companyId: string) {
  return {
    ...reader(db, companyId, aiUsage),
    /** Adds to the counter of `month` (`YYYY-MM-01`), creating the row on first use. */
    async record(
      month: string,
      delta: { requests?: number; inputTokens?: number; outputTokens?: number },
    ): Promise<AiUsageRow> {
      const requests = delta.requests ?? 0;
      const inputTokens = delta.inputTokens ?? 0;
      const outputTokens = delta.outputTokens ?? 0;
      const rows = await db
        .insert(aiUsage)
        .values({ companyId, month, requests, inputTokens, outputTokens })
        .onConflictDoUpdate({
          target: [aiUsage.companyId, aiUsage.month],
          set: {
            requests: sql`${aiUsage.requests} + ${requests}`,
            inputTokens: sql`${aiUsage.inputTokens} + ${inputTokens}`,
            outputTokens: sql`${aiUsage.outputTokens} + ${outputTokens}`,
            updatedAt: new Date(),
          },
        })
        .returning();
      return rows[0] as AiUsageRow;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Repository API bound to one company. Pass the company from the authenticated session only.
 * Rows of other companies are invisible: `get` returns `null`, `list` omits them, `update`
 * changes nothing and returns `null`, and inserts that reference them fail on the composite
 * foreign keys.
 */
export function forCompany(db: Db, companyId: string) {
  return {
    companyId,
    company: {
      async get(): Promise<Company | null> {
        const rows = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
        return rows[0] ?? null;
      },
      async update(patch: Partial<NewCompany>): Promise<Company | null> {
        const rows = await db
          .update(companiesTable)
          .set({ ...stripOwned(patch), updatedAt: new Date() })
          .where(eq(companiesTable.id, companyId))
          .returning();
        return rows[0] ?? null;
      },
    },
    users: mutable(db, companyId, users),
    machines: machinesRepo(db, companyId),
    machineProfileVersions: reader(db, companyId, machineProfileVersions),
    tools: mutable(db, companyId, tools),
    materials: mutable(db, companyId, materials),
    templates: templatesRepo(db, companyId),
    templateVersions: reader(db, companyId, templateVersions),
    projects: projectsRepo(db, companyId),
    projectCommands: reader(db, companyId, projectCommands),
    exports: appendOnly(db, companyId, exportsTable),
    validations: appendOnly(db, companyId, validations),
    offcuts: mutable(db, companyId, offcuts),
    chatMessages: appendOnly(db, companyId, chatMessages),
    aiUsage: aiUsageRepo(db, companyId),
  };
}

export type CompanyScope = ReturnType<typeof forCompany>;
