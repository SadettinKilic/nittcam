/**
 * Tenant-scoped repository API (spec §8.6, D-014). `forCompany(db, companyId)` is the only way to
 * read or write tenant data: every query below filters by `company_id` inside the helper, and
 * every insert sets `company_id` itself (a caller-supplied value is overwritten). The only
 * company-agnostic query is `companies.create`.
 */
import {
  currentVerificationState,
  DEFAULT_LIBRARY,
  libraryMaterialSchema,
  type LibraryMaterial,
  parseMachineProfile,
  parseProject,
  type CommandLogEntry,
  type MachineProfile,
  type MachineProfileIssue,
  type Project,
  type VerificationStage,
  type VerificationState,
} from '@nittcam/core';
import { and, asc, desc, eq, isNotNull, isNull, max, sql } from 'drizzle-orm';
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

/** The machine profile JSON failed core `parseMachineProfile`; nothing was written. */
export class InvalidMachineProfile extends Error {
  override readonly name = 'InvalidMachineProfile';
  constructor(readonly issues: MachineProfileIssue[]) {
    super(`invalid machine profile: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }
}

/** A material library entry failed core `libraryMaterialSchema`; nothing was written (T121). */
export class InvalidMaterial extends Error {
  override readonly name = 'InvalidMaterial';
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`invalid material: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }
}

/** A client-chosen project id is already used by another company (D-030); nothing was written. */
export class IdTaken extends Error {
  override readonly name = 'IdTaken';
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} ${id}: id already taken`);
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
// Material library (T121)
// ---------------------------------------------------------------------------------------------

export type MaterialRow = typeof materials.$inferSelect;

function validMaterial(json: unknown): LibraryMaterial {
  const parsed = libraryMaterialSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidMaterial(
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}

function materialsRepo(db: Db, companyId: string) {
  const own = (id: string) => and(eq(materials.id, id), eq(materials.companyId, companyId));
  const get = async (id: string): Promise<MaterialRow | null> => {
    const rows = await db.select().from(materials).where(own(id));
    return rows[0] ?? null;
  };
  return {
    /** Entries of the company, by name (Turkish collation is done by the caller). */
    async list(): Promise<MaterialRow[]> {
      return db
        .select()
        .from(materials)
        .where(eq(materials.companyId, companyId))
        .orderBy(asc(materials.name), asc(materials.createdAt));
    },
    get,
    /** Validates with core and inserts; throws `InvalidMaterial`. */
    async create(json: unknown): Promise<MaterialRow> {
      const m = validMaterial(json !== null && typeof json === 'object' ? stripOwned(json) : json);
      const rows = await db
        .insert(materials)
        .values({ ...m, companyId })
        .returning();
      return rows[0] as MaterialRow;
    },
    /**
     * Merges `patch` onto the entry and validates the result; `null` when it does not exist in
     * this company (nothing changes). Keys the helper owns (id, company, timestamps) are ignored.
     */
    async update(id: string, patch: unknown): Promise<MaterialRow | null> {
      const current = await get(id);
      if (!current) return null;
      const { kind, name, thicknesses, tone, grain, sheetSizes } = current;
      const changes = patch !== null && typeof patch === 'object' ? stripOwned(patch) : {};
      const m = validMaterial({ kind, name, thicknesses, tone, grain, sheetSizes, ...changes });
      const rows = await db
        .update(materials)
        .set({ ...m, updatedAt: new Date() })
        .where(own(id))
        .returning();
      return rows[0] ?? null;
    },
    /** `false` when it does not exist in this company. Projects keep their stock (by value). */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(materials).where(own(id)).returning({ id: materials.id });
      return rows.length > 0;
    },
    /**
     * Seeds the default library once per company (D-044): only when the company was never seeded
     * and has no entry; the company row remembers it, so an emptied library stays empty. Returns
     * the count added.
     */
    async seedDefaults(): Promise<number> {
      return db.transaction(async (tx) => {
        // Lock the company row: two first requests must not seed twice.
        const company = await tx
          .select({ seededAt: companiesTable.materialsSeededAt })
          .from(companiesTable)
          .where(eq(companiesTable.id, companyId))
          .for('update');
        if (!company[0] || company[0].seededAt) return 0;
        const existing = await tx
          .select({ id: materials.id })
          .from(materials)
          .where(eq(materials.companyId, companyId))
          .limit(1);
        if (existing.length === 0) {
          await tx.insert(materials).values(DEFAULT_LIBRARY.map((m) => ({ ...m, companyId })));
        }
        await tx
          .update(companiesTable)
          .set({ materialsSeededAt: new Date() })
          .where(eq(companiesTable.id, companyId));
        return existing.length === 0 ? DEFAULT_LIBRARY.length : 0;
      });
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
  /**
   * Single-user bootstrap (D-016, until auth in T023): returns the company with this fixed id,
   * creating it on first use. `created` is true only for the call that inserted it, so the caller
   * can seed it exactly once even when two requests race.
   */
  async ensure(
    db: Db,
    id: string,
    values: NewCompany,
  ): Promise<{ company: Company; created: boolean }> {
    const inserted = await db
      .insert(companiesTable)
      .values({ ...(stripOwned(values) as NewCompany), id })
      .onConflictDoNothing({ target: companiesTable.id })
      .returning();
    if (inserted[0]) return { company: inserted[0], created: true };
    const rows = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    return { company: rows[0] as Company, created: false };
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
export type TemplateRow = typeof templatesTable.$inferSelect;
export type ValidationRow = typeof validations.$inferSelect;

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

/**
 * Stored project JSON may be an older schema version (schema v2, D-034): it is upgraded on read so
 * callers always get the latest shape. A row that does not parse is returned unchanged.
 */
function upgradeRow(row: ProjectRow): ProjectRow {
  const result = parseProject(row.data);
  return result.ok ? { ...row, data: result.project } : row;
}

function validProject(data: unknown): Project {
  const result = parseProject(data);
  if (!result.ok) throw new InvalidProject(result.issues);
  return result.project;
}

export interface NewProject {
  /** Client-generated id (D-030); the database generates one when it is missing. */
  id?: string;
  name: string;
  status?: ProjectRow['status'];
  /** Raw project JSON; validated (and migrated) with core `parseProject`. */
  data: unknown;
  /** Commands that produced `data` from an empty draft; stored under revision 1 (D-029). */
  commands?: readonly CommandLogEntry[];
  /** User who created it (same company); stored on the command rows. */
  userId?: string;
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
  /** Appends the command log rows of one save (`seq` = order within the save). */
  async function insertCommands(
    tx: Pick<Db, 'insert'>,
    projectId: string,
    revision: number,
    commands: readonly CommandLogEntry[],
    userId: string | undefined,
  ): Promise<void> {
    if (commands.length === 0) return;
    await tx.insert(projectCommands).values(
      commands.map((c, seq) => ({
        companyId,
        projectId,
        revision,
        seq,
        command: c.command,
        params: c.params,
        actor: c.actor,
        at: new Date(c.at),
        userId: userId ?? null,
      })),
    );
  }
  return {
    ...base,
    async get(id: string) {
      const row = await base.get(id);
      return row ? upgradeRow(row) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.companyId, companyId), isNull(projectsTable.deletedAt)))
        .orderBy(desc(projectsTable.updatedAt));
      return rows.map(upgradeRow);
    },
    /** Soft-deleted projects (T178 "Silinenler"), newest deletion first. */
    async listDeleted() {
      const rows = await db
        .select()
        .from(projectsTable)
        .where(and(eq(projectsTable.companyId, companyId), isNotNull(projectsTable.deletedAt)))
        .orderBy(desc(projectsTable.deletedAt));
      return rows.map(upgradeRow);
    },
    /**
     * Soft delete or restore (T178): a deleted project leaves `list` (Projeler, Ana sayfa) but keeps
     * its data, commands and exports, so it can be restored. Does not touch `updatedAt` or the
     * revision. Null for an unknown id or another company's project.
     */
    async setDeleted(id: string, deleted: boolean): Promise<ProjectRow | null> {
      const rows = await db
        .update(projectsTable)
        .set({ deletedAt: deleted ? new Date() : null })
        .where(scope(id))
        .returning();
      const row = rows[0];
      return row ? upgradeRow(row) : null;
    },
    /**
     * Project status (T179, spec §3.4: taslak → üretildi → tamamlandı). Status is not project
     * data: the revision and `updatedAt` stay. Null for an unknown id or another company's project.
     */
    async setStatus(id: string, status: ProjectRow['status']): Promise<ProjectRow | null> {
      const rows = await db
        .update(projectsTable)
        .set({ status })
        .where(scope(id))
        .returning();
      const row = rows[0];
      return row ? upgradeRow(row) : null;
    },
    async create(values: NewProject): Promise<ProjectRow> {
      const data = validProject(values.data);
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(projectsTable)
          .values({
            companyId,
            name: values.name,
            ...(values.status ? { status: values.status } : {}),
            data,
            revision: 1,
          })
          .returning();
        const created = rows[0] as ProjectRow;
        await insertCommands(tx, created.id, 1, values.commands ?? [], values.userId);
        return created;
      });
    },
    /**
     * Idempotent create on a client-generated id (D-030): a second create with the same id returns
     * the stored project (`created: false`) and writes nothing, so a reload during the very first
     * save cannot create a duplicate. An id used by another company throws `IdTaken` (its row
     * stays invisible).
     */
    async createOnce(
      values: NewProject & { id: string },
    ): Promise<{ row: ProjectRow; created: boolean }> {
      const data = validProject(values.data);
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(projectsTable)
          .values({
            id: values.id,
            companyId,
            name: values.name,
            ...(values.status ? { status: values.status } : {}),
            data,
            revision: 1,
          })
          .onConflictDoNothing({ target: projectsTable.id })
          .returning();
        const created = rows[0];
        if (created) {
          await insertCommands(tx, created.id, 1, values.commands ?? [], values.userId);
          return { row: created, created: true };
        }
        const existing = await tx.select().from(projectsTable).where(scope(values.id));
        const row = existing[0];
        if (!row) throw new IdTaken('project', values.id);
        return { row: upgradeRow(row), created: false };
      });
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
        await insertCommands(tx, id, saved.revision, input.commands ?? [], input.userId);
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

/** A transaction handle (same API as `Db`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A machine with its latest profile version and derived verification state (§7.3). */
export interface MachineWithProfile {
  machine: MachineRow;
  version: MachineProfileVersionRow;
  profile: MachineProfile;
  state: VerificationState;
}

function validMachineProfile(json: unknown): MachineProfile {
  const result = parseMachineProfile(json);
  if (!result.ok) throw new InvalidMachineProfile(result.issues);
  return result.profile;
}

/**
 * Columns written for a profile version. The post config itself arrives with T017; until then the
 * version row records which post (`id`) and which post version the profile points at (D-016).
 */
function versionValues(profile: MachineProfile): NewProfileVersion {
  return {
    profile: profile as unknown as Record<string, unknown>,
    postConfig: { id: profile.post.id },
    postVersion: profile.post.version,
  };
}

/** Denormalised machine columns kept in step with the latest profile. */
function machineColumns(profile: MachineProfile) {
  return {
    name: profile.identity.name,
    brand: profile.identity.brand,
    model: profile.identity.model,
  };
}

function machinesRepo(db: Db, companyId: string) {
  const ownedMachine = (machineId: string) =>
    and(eq(machinesTable.id, machineId), eq(machinesTable.companyId, companyId));
  const versionsOf = (machineId: string) =>
    and(
      eq(machineProfileVersions.machineId, machineId),
      eq(machineProfileVersions.companyId, companyId),
    );

  async function insertVersion(
    tx: Tx,
    machineId: string,
    values: NewProfileVersion,
  ): Promise<MachineProfileVersionRow> {
    const last = await tx
      .select({ v: max(machineProfileVersions.version) })
      .from(machineProfileVersions)
      .where(versionsOf(machineId));
    const rows = await tx
      .insert(machineProfileVersions)
      .values({ companyId, machineId, version: (last[0]?.v ?? 0) + 1, ...values })
      .returning();
    return rows[0] as MachineProfileVersionRow;
  }

  /** Replaces the machine's `tools` rows with the tool table of `profile` (same transaction). */
  async function syncTools(tx: Tx, machineId: string, profile: MachineProfile): Promise<void> {
    await tx
      .delete(tools)
      .where(and(eq(tools.machineId, machineId), eq(tools.companyId, companyId)));
    await tx.insert(tools).values(
      profile.tools.map((t) => ({
        companyId,
        machineId,
        number: t.number,
        type: t.type,
        diameter: t.diameter,
      })),
    );
  }

  /** Latest recorded verification of the machine, with the profile it was recorded against. */
  async function lastVerification(machineId: string) {
    const rows = await db
      .select({ stage: validations.stage, profile: machineProfileVersions.profile })
      .from(validations)
      .innerJoin(
        machineProfileVersions,
        and(
          eq(validations.machineProfileVersionId, machineProfileVersions.id),
          eq(validations.companyId, machineProfileVersions.companyId),
        ),
      )
      .where(
        and(eq(validations.companyId, companyId), eq(machineProfileVersions.machineId, machineId)),
      )
      .orderBy(desc(validations.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const parsed = parseMachineProfile(row.profile);
    // A version that predates the T010 schema cannot be compared: count it as changed.
    return { stage: row.stage, profile: parsed.ok ? parsed.profile : null };
  }

  async function withProfile(machine: MachineRow): Promise<MachineWithProfile | null> {
    const versions = await db
      .select()
      .from(machineProfileVersions)
      .where(versionsOf(machine.id))
      .orderBy(desc(machineProfileVersions.version))
      .limit(1);
    const version = versions[0];
    if (!version) return null;
    const parsed = parseMachineProfile(version.profile);
    if (!parsed.ok) return null;
    const last = await lastVerification(machine.id);
    let state: VerificationState = 'draft';
    if (last && last.profile === null) state = 'reverify_needed';
    else if (last && last.profile) {
      state = currentVerificationState(parsed.profile, {
        stage: last.stage,
        profile: last.profile,
      });
    }
    return { machine, version, profile: parsed.profile, state };
  }

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
          .where(ownedMachine(machineId));
        if (owner.length === 0) throw new NotFound('machine', machineId);
        return insertVersion(tx, machineId, values);
      });
    },
    /** All versions of a machine, oldest first. */
    async listProfileVersions(machineId: string): Promise<MachineProfileVersionRow[]> {
      return db
        .select()
        .from(machineProfileVersions)
        .where(versionsOf(machineId))
        .orderBy(asc(machineProfileVersions.version));
    },
    /**
     * Creates a machine from a profile (validated with core `parseMachineProfile`): the machine
     * row, profile version 1 and its tools, in one transaction. Throws `InvalidMachineProfile`.
     */
    async createWithProfile(json: unknown): Promise<MachineWithProfile> {
      const profile = validMachineProfile(json);
      const { machine, version } = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(machinesTable)
          .values({ companyId, ...machineColumns(profile) })
          .returning();
        const machine = rows[0] as MachineRow;
        const version = await insertVersion(tx, machine.id, versionValues(profile));
        await syncTools(tx, machine.id, profile);
        return { machine, version };
      });
      return { machine, version, profile, state: 'draft' };
    },
    /**
     * Saves an edited profile as a new immutable version (`max + 1`), refreshes the machine's
     * name/brand/model and replaces its `tools` rows, in one transaction. The returned `state`
     * is re-derived: a verified machine whose profile, tool set or post version changed is now
     * `reverify_needed` (§7.3). Throws `InvalidMachineProfile` or `NotFound`.
     */
    async saveProfile(machineId: string, json: unknown): Promise<MachineWithProfile> {
      const profile = validMachineProfile(json);
      const machine = await db.transaction(async (tx) => {
        const rows = await tx
          .update(machinesTable)
          .set({ ...machineColumns(profile), updatedAt: new Date() })
          .where(ownedMachine(machineId))
          .returning();
        const machine = rows[0];
        if (!machine) throw new NotFound('machine', machineId);
        await insertVersion(tx, machineId, versionValues(profile));
        await syncTools(tx, machineId, profile);
        return machine;
      });
      const result = await withProfile(machine);
      if (!result) throw new NotFound('machine', machineId);
      return result;
    },
    /**
     * One specific profile version of a machine (by version number or row id) with its derived
     * verification state (§7.3: the last recorded verification compared with *this* version), for
     * exports bound to the version a project was built with (D-030). `null` if not found or the
     * stored profile no longer parses.
     */
    async getProfileVersion(
      machineId: string,
      which: { version: number } | { id: string },
    ): Promise<MachineWithProfile | null> {
      const rows = await db.select().from(machinesTable).where(ownedMachine(machineId));
      const machine = rows[0];
      if (!machine) return null;
      const versions = await db
        .select()
        .from(machineProfileVersions)
        .where(
          and(
            versionsOf(machineId),
            'id' in which
              ? eq(machineProfileVersions.id, which.id)
              : eq(machineProfileVersions.version, which.version),
          ),
        );
      const version = versions[0];
      if (!version) return null;
      const parsed = parseMachineProfile(version.profile);
      if (!parsed.ok) return null;
      const last = await lastVerification(machineId);
      let state: VerificationState = 'draft';
      if (last && last.profile === null) state = 'reverify_needed';
      else if (last && last.profile) {
        state = currentVerificationState(parsed.profile, {
          stage: last.stage,
          profile: last.profile,
        });
      }
      return { machine, version, profile: parsed.profile, state };
    },
    /**
     * Records a verification step (§7.3, T022) against a profile version of this machine: the
     * stage, the tool-set snapshot and post version of that version, the measurement form and
     * who approved it. Append-only; the machine's state is derived from the latest record.
     * Throws `NotFound` when the version does not belong to the machine.
     */
    async recordVerification(
      machineId: string,
      values: {
        profileVersionId: string;
        stage: VerificationStage;
        measurements?: Record<string, unknown>;
        approvedBy?: string | null;
      },
    ): Promise<ValidationRow> {
      const versions = await db
        .select()
        .from(machineProfileVersions)
        .where(and(versionsOf(machineId), eq(machineProfileVersions.id, values.profileVersionId)));
      const version = versions[0];
      if (!version) throw new NotFound('machine profile version', values.profileVersionId);
      const parsed = parseMachineProfile(version.profile);
      const rows = await db
        .insert(validations)
        .values({
          companyId,
          machineProfileVersionId: version.id,
          toolSet: parsed.ok ? (parsed.profile.tools as unknown[]) : [],
          postVersion: version.postVersion,
          stage: values.stage,
          level: 'user_approved',
          measurements: values.measurements ?? {},
          approvedBy: values.approvedBy ?? null,
        })
        .returning();
      return rows[0] as ValidationRow;
    },
    /** Every recorded verification step of the machine, newest first, with its version number. */
    async verificationHistory(
      machineId: string,
    ): Promise<{ validation: ValidationRow; version: number }[]> {
      const rows = await db
        .select({ validation: validations, version: machineProfileVersions.version })
        .from(validations)
        .innerJoin(
          machineProfileVersions,
          and(
            eq(validations.machineProfileVersionId, machineProfileVersions.id),
            eq(validations.companyId, machineProfileVersions.companyId),
          ),
        )
        .where(
          and(
            eq(validations.companyId, companyId),
            eq(machineProfileVersions.machineId, machineId),
          ),
        )
        .orderBy(desc(validations.createdAt));
      return rows;
    },
    /** A machine with its latest profile version and verification state; `null` if not found. */
    async getWithProfile(machineId: string): Promise<MachineWithProfile | null> {
      const rows = await db.select().from(machinesTable).where(ownedMachine(machineId));
      const machine = rows[0];
      return machine ? withProfile(machine) : null;
    },
    /**
     * Every machine that has a valid profile version, oldest first, with its verification state.
     * Machines without a T010 profile (none exist outside tests) are left out.
     */
    async listWithProfiles(): Promise<MachineWithProfile[]> {
      const machines = await db
        .select()
        .from(machinesTable)
        .where(eq(machinesTable.companyId, companyId))
        .orderBy(asc(machinesTable.createdAt), asc(machinesTable.name));
      const out: MachineWithProfile[] = [];
      for (const m of machines) {
        const item = await withProfile(m);
        if (item) out.push(item);
      }
      return out;
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
    /** A new template with its version 1 in one transaction (T147 "şablon olarak kaydet"). */
    async createWithVersion(
      name: string,
      values: NewTemplateVersion,
    ): Promise<{ template: TemplateRow; version: TemplateVersionRow }> {
      return db.transaction(async (tx) => {
        const created = await tx.insert(templatesTable).values({ companyId, name }).returning();
        const template = created[0] as TemplateRow;
        const rows = await tx
          .insert(templateVersions)
          .values({
            companyId,
            templateId: template.id,
            version: 1,
            params: values.params,
            geometry: values.geometry,
          })
          .returning();
        return { template, version: rows[0] as TemplateVersionRow };
      });
    },
    /** One version of a company template; `null` when the template or version is not the company's. */
    async getVersion(templateId: string, version: number): Promise<TemplateVersionRow | null> {
      const rows = await db
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, templateId),
            eq(templateVersions.companyId, companyId),
            eq(templateVersions.version, version),
          ),
        );
      return rows[0] ?? null;
    },
    /** Every company template with its latest version (T148 "Şablon ekle", T149 update check). */
    async listLatest(): Promise<{ template: TemplateRow; version: TemplateVersionRow }[]> {
      const all = await db
        .select()
        .from(templatesTable)
        .where(eq(templatesTable.companyId, companyId))
        .orderBy(asc(templatesTable.name), asc(templatesTable.id));
      const versions = await db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.companyId, companyId))
        .orderBy(asc(templateVersions.version));
      const latest = new Map<string, TemplateVersionRow>();
      for (const v of versions) latest.set(v.templateId, v);
      return all.flatMap((template) => {
        const version = latest.get(template.id);
        return version ? [{ template, version }] : [];
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

export type ExportRow = typeof exportsTable.$inferSelect;
export type NewExport = NewRow<typeof exportsTable> & { id?: string };

/** The fields that make two exports the same (D-030 idempotency). */
export type ExportKey = Pick<
  ExportRow,
  | 'projectId'
  | 'projectRevision'
  | 'machineProfileVersionId'
  | 'postId'
  | 'postVersion'
  | 'kind'
  | 'sha256'
>;

function exportsRepo(db: Db, companyId: string) {
  const sameKey = (k: ExportKey) =>
    and(
      eq(exportsTable.companyId, companyId),
      eq(exportsTable.projectId, k.projectId),
      eq(exportsTable.projectRevision, k.projectRevision),
      eq(exportsTable.machineProfileVersionId, k.machineProfileVersionId),
      eq(exportsTable.postId, k.postId),
      eq(exportsTable.postVersion, k.postVersion),
      eq(exportsTable.kind, k.kind),
      eq(exportsTable.sha256, k.sha256),
    );
  async function findSame(key: ExportKey): Promise<ExportRow | null> {
    const rows = await db.select().from(exportsTable).where(sameKey(key));
    return rows[0] ?? null;
  }
  return {
    ...appendOnly(db, companyId, exportsTable),
    /** The export with the same key, or null. */
    findSame,
    /**
     * Inserts the export once (append-only, no update path). When an export with the same key
     * already exists (an earlier or a concurrent request), nothing is written and the existing row
     * comes back with `created: false`.
     */
    async createOnce(values: NewExport): Promise<{ row: ExportRow; created: boolean }> {
      const { id, ...rest } = values;
      const rows = await db
        .insert(exportsTable)
        .values({
          ...(stripOwned(rest) as NewRow<typeof exportsTable>),
          ...(id ? { id } : {}),
          companyId,
        })
        .onConflictDoNothing()
        .returning();
      if (rows[0]) return { row: rows[0], created: true };
      const existing = await findSame(values);
      if (!existing) throw new Error('export insert conflicted but no matching export was found');
      return { row: existing, created: false };
    },
    /** Exports of a project, newest first. Empty for another company's project. */
    async listForProject(projectId: string): Promise<ExportRow[]> {
      return db
        .select()
        .from(exportsTable)
        .where(and(eq(exportsTable.companyId, companyId), eq(exportsTable.projectId, projectId)))
        .orderBy(desc(exportsTable.createdAt), desc(exportsTable.id));
    },
    /** The newest NC export of every project of the company (Projeler list; T176: not DXF/PDF). */
    async latestPerProject(): Promise<ExportRow[]> {
      return db
        .selectDistinctOn([exportsTable.projectId])
        .from(exportsTable)
        .where(and(eq(exportsTable.companyId, companyId), eq(exportsTable.kind, 'nc')))
        .orderBy(exportsTable.projectId, desc(exportsTable.createdAt), desc(exportsTable.id));
    },
  };
}

export type UserRow = typeof users.$inferSelect;

function usersRepo(db: Db, companyId: string) {
  const first = async (): Promise<UserRow | null> =>
    (
      await db
        .select()
        .from(users)
        .where(eq(users.companyId, companyId))
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(1)
    )[0] ?? null;
  return {
    ...mutable(db, companyId, users),
    /**
     * Single-user mode (D-016, D-030): the company's first user, created on first use with the
     * given e-mail. Until auth exists every recorded action belongs to this user.
     */
    async ensureDefault(values: { email: string; name: string }): Promise<UserRow> {
      const found = await first();
      if (found) return found;
      await db
        .insert(users)
        .values({ companyId, email: values.email, name: values.name, role: 'admin' })
        .onConflictDoNothing();
      const created = await first();
      if (!created) throw new Error('default user could not be created');
      return created;
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
    users: usersRepo(db, companyId),
    machines: machinesRepo(db, companyId),
    machineProfileVersions: reader(db, companyId, machineProfileVersions),
    tools: mutable(db, companyId, tools),
    materials: materialsRepo(db, companyId),
    templates: templatesRepo(db, companyId),
    templateVersions: reader(db, companyId, templateVersions),
    projects: projectsRepo(db, companyId),
    projectCommands: reader(db, companyId, projectCommands),
    exports: exportsRepo(db, companyId),
    validations: appendOnly(db, companyId, validations),
    offcuts: mutable(db, companyId, offcuts),
    chatMessages: appendOnly(db, companyId, chatMessages),
    aiUsage: aiUsageRepo(db, companyId),
  };
}

export type CompanyScope = ReturnType<typeof forCompany>;
