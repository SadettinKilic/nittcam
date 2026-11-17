/**
 * Database schema v1 (spec §9.1, D-014). Drizzle ORM, PostgreSQL dialect.
 *
 * Tenancy rules (spec §8.6):
 * - Every table except `companies` has `company_id` (not null, FK, indexed).
 * - Each table referenced by another tenant table has `unique(company_id, id)`; children point at it
 *   with a composite FK `(company_id, parent_id)`, so the database itself rejects a row that links
 *   to another company's parent.
 * - Append-only tables (versions, command log, exports, validations, chat) have `created_at` only;
 *   the repository API has no update path for them.
 */
import type { CommandLogEntry, Project } from '@nittcam/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------------------------
// Enums (fixed value lists from the spec)
// ---------------------------------------------------------------------------------------------

/** §3.5 / §9.1: yönetici / operatör. */
export const userRole = pgEnum('user_role', ['admin', 'operator']);
/** §9.1 project status. */
export const projectStatus = pgEnum('project_status', ['draft', 'produced', 'completed']);
/** §7.3 machine profile validation stages, in order. */
export const validationStage = pgEnum('validation_stage', [
  'draft',
  'air_cut_approved',
  'test_cut_approved',
  'verified',
]);
/** §7.3 "İki seviye": tested by NittCam on its own machines / approved by the customer. */
export const validationLevel = pgEnum('validation_level', ['nittcam_tested', 'user_approved']);
/** §5.1 who issued a command; same values as core `actorSchema`. */
export const commandActor = pgEnum('command_actor', ['user', 'ai']);
/** §6.6 export kinds. */
export const exportKind = pgEnum('export_kind', ['nc', 'dxf', 'pdf', 'report']);
/** Offcut stock state (spec gives no list; D-014). */
export const offcutStatus = pgEnum('offcut_status', ['available', 'reserved', 'used']);
/** Chat message author. */
export const chatRole = pgEnum('chat_role', ['user', 'assistant']);

// ---------------------------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------------------------

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const companyId = () =>
  uuid('company_id')
    .notNull()
    .references((): AnyPgColumn => companies.id, { onDelete: 'restrict' });

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

/** Tenant. The only table without `company_id`. */
export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  logoKey: text('logo_key'),
  /** Package / plan (§13.1). Free text until pricing is decided. */
  plan: text('plan').notNull().default('trial'),
  /** Monthly AI quota in requests (§9.1 "AI kotası"). */
  aiQuotaMonthly: integer('ai_quota_monthly').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    companyId: companyId(),
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    role: userRole('role').notNull().default('operator'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('users_company_id_id_uq').on(t.companyId, t.id),
    // One login per e-mail across the platform (case-insensitive).
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
  ],
);

export const machines = pgTable(
  'machines',
  {
    id: id(),
    companyId: companyId(),
    name: text('name').notNull(),
    brand: text('brand').notNull().default(''),
    model: text('model').notNull().default(''),
    /** Maintenance log entries (§9.1 "bakım kaydı"); shape is decided with the machine screens. */
    maintenanceLog: jsonb('maintenance_log').$type<unknown[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('machines_company_id_id_uq').on(t.companyId, t.id)],
);

/** Immutable: a profile edit inserts a new row with the next version number. */
export const machineProfileVersions = pgTable(
  'machine_profile_versions',
  {
    id: id(),
    companyId: companyId(),
    machineId: uuid('machine_id').notNull(),
    version: integer('version').notNull(),
    /** Machine profile JSON (§7.1); the schema arrives with T010. */
    profile: jsonb('profile').$type<Record<string, unknown>>().notNull(),
    /** Post processor configuration (§6.4). */
    postConfig: jsonb('post_config').$type<Record<string, unknown>>().notNull(),
    postVersion: text('post_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('mpv_company_id_id_uq').on(t.companyId, t.id),
    unique('mpv_machine_version_uq').on(t.machineId, t.version),
    index('mpv_company_machine_idx').on(t.companyId, t.machineId),
    foreignKey({
      name: 'mpv_machine_fk',
      columns: [t.companyId, t.machineId],
      foreignColumns: [machines.companyId, machines.id],
    }).onDelete('restrict'),
    check('mpv_version_positive', sql`${t.version} >= 1`),
  ],
);

/** Tool set of a machine (§9.1: makine, takım no, tip, çap). */
export const tools = pgTable(
  'tools',
  {
    id: id(),
    companyId: companyId(),
    machineId: uuid('machine_id').notNull(),
    number: integer('number').notNull(),
    type: text('type').notNull(),
    /** Millimetres. */
    diameter: doublePrecision('diameter').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tools_machine_number_uq').on(t.machineId, t.number),
    index('tools_company_machine_idx').on(t.companyId, t.machineId),
    foreignKey({
      name: 'tools_machine_fk',
      columns: [t.companyId, t.machineId],
      foreignColumns: [machines.companyId, machines.id],
    }).onDelete('cascade'),
    check('tools_number_positive', sql`${t.number} >= 1`),
    check('tools_diameter_positive', sql`${t.diameter} > 0`),
  ],
);

/** Material parameter sets (§9.1: tür, kalınlık, besleme, devir, paso). */
export const materials = pgTable(
  'materials',
  {
    id: id(),
    companyId: companyId(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    /** mm */
    thickness: doublePrecision('thickness').notNull(),
    /** mm/min */
    feed: doublePrecision('feed').notNull(),
    /** rpm */
    spindleSpeed: integer('spindle_speed').notNull(),
    /** Depth per pass, mm. */
    stepDown: doublePrecision('step_down').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('materials_company_idx').on(t.companyId)],
);

export const templates = pgTable(
  'templates',
  {
    id: id(),
    companyId: companyId(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('templates_company_id_id_uq').on(t.companyId, t.id)],
);

/** Immutable: a template edit inserts a new row with the next version number. */
export const templateVersions = pgTable(
  'template_versions',
  {
    id: id(),
    companyId: companyId(),
    templateId: uuid('template_id').notNull(),
    version: integer('version').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    geometry: jsonb('geometry').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('tv_template_version_uq').on(t.templateId, t.version),
    index('tv_company_template_idx').on(t.companyId, t.templateId),
    foreignKey({
      name: 'tv_template_fk',
      columns: [t.companyId, t.templateId],
      foreignColumns: [templates.companyId, templates.id],
    }).onDelete('restrict'),
    check('tv_version_positive', sql`${t.version} >= 1`),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    companyId: companyId(),
    name: text('name').notNull(),
    status: projectStatus('status').notNull().default('draft'),
    /** Optimistic lock: every save increments it; a save with a stale value is rejected. */
    revision: integer('revision').notNull().default(1),
    /** Project JSON (§9.2), validated with core `parseProject` before every write. */
    data: jsonb('data').$type<Project>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('projects_company_id_id_uq').on(t.companyId, t.id),
    index('projects_company_updated_idx').on(t.companyId, t.updatedAt),
    check('projects_revision_positive', sql`${t.revision} >= 1`),
  ],
);

/** Append-only command log (§5.1); one row per core `CommandLogEntry`. */
export const projectCommands = pgTable(
  'project_commands',
  {
    id: id(),
    companyId: companyId(),
    projectId: uuid('project_id').notNull(),
    /** Project revision produced by the save that carried this command. */
    revision: integer('revision').notNull(),
    /** Order within the save (0-based). */
    seq: integer('seq').notNull(),
    command: text('command').notNull(),
    params: jsonb('params').$type<CommandLogEntry['params']>().notNull(),
    actor: commandActor('actor').notNull(),
    /** Who sent it (same company); null for system actions. */
    userId: uuid('user_id'),
    /** `CommandLogEntry.at` (time the command was issued on the client). */
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('pc_project_revision_seq_uq').on(t.projectId, t.revision, t.seq),
    index('pc_company_project_idx').on(t.companyId, t.projectId),
    foreignKey({
      name: 'pc_project_fk',
      columns: [t.companyId, t.projectId],
      foreignColumns: [projects.companyId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'pc_user_fk',
      columns: [t.companyId, t.userId],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/** One file of an export (`exports.files`, D-030). */
export interface ExportFileEntry {
  /** File name as generated by the post (ASCII, within the profile's name-length limit). */
  name: string;
  /** Storage key relative to the company's storage view. */
  key: string;
  /** Bytes. */
  size: number;
  /** sha256 hex of the file bytes. */
  sha256: string;
  /** 0-based sheet index the program belongs to. */
  sheet: number;
}

/**
 * Generated files (§6.6, D-030). Append-only; files are never deleted (§8.6). One row per export
 * run, its files listed in `files`. The row is written once with the unverified-profile acceptance
 * (§7.2 rule 10) already in it: the check constraint makes an unaccepted unverified export
 * impossible.
 */
export const exports = pgTable(
  'exports',
  {
    id: id(),
    companyId: companyId(),
    projectId: uuid('project_id').notNull(),
    projectRevision: integer('project_revision').notNull(),
    machineProfileVersionId: uuid('machine_profile_version_id').notNull(),
    /** Post processor id (`generic`, `mach3`, …). */
    postId: text('post_id').notNull(),
    postVersion: text('post_version').notNull(),
    kind: exportKind('kind').notNull(),
    /** Storage folder of the export's files (see `Storage`). */
    fileKey: text('file_key').notNull(),
    /**
     * sha256 hex of the export: the hash of its manifest, one `<file sha256>  <name>\n` line per
     * file in order (the `sha256sum` format). Part of the idempotency key.
     */
    sha256: text('sha256').notNull(),
    /** The files with their own hashes. */
    files: jsonb('files').$type<ExportFileEntry[]>().notNull().default([]),
    /** Validation stage of the profile version at export time (§6.6 file header). */
    validationStage: validationStage('validation_stage').notNull(),
    /** Derived verification state at export time (`reverify_needed` included). */
    verificationState: text('verification_state').notNull().default('draft'),
    /** The files carry "DOĞRULANMADI, önce air cut" (§7.2 rule 10), so acceptance was required. */
    unverified: boolean('unverified').notNull().default(true),
    /** When the user accepted the unverified-profile warning (null for a verified export). */
    acceptedUnverifiedAt: timestamp('accepted_unverified_at', { withTimezone: true, mode: 'date' }),
    acceptedBy: uuid('accepted_by'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('exports_company_project_idx').on(t.companyId, t.projectId, t.createdAt),
    uniqueIndex('exports_idempotency_uq').on(
      t.companyId,
      t.projectId,
      t.projectRevision,
      t.machineProfileVersionId,
      t.postId,
      t.postVersion,
      t.kind,
      t.sha256,
    ),
    foreignKey({
      name: 'exports_project_fk',
      columns: [t.companyId, t.projectId],
      foreignColumns: [projects.companyId, projects.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'exports_mpv_fk',
      columns: [t.companyId, t.machineProfileVersionId],
      foreignColumns: [machineProfileVersions.companyId, machineProfileVersions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'exports_user_fk',
      columns: [t.companyId, t.createdBy],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: 'exports_accepted_by_fk',
      columns: [t.companyId, t.acceptedBy],
      foreignColumns: [users.companyId, users.id],
    }),
    check(
      'exports_unverified_accepted',
      sql`${t.unverified} = false OR ${t.acceptedUnverifiedAt} IS NOT NULL`,
    ),
    check(
      'exports_verification_state',
      sql`${t.verificationState} IN ('draft', 'air_cut_approved', 'test_cut_approved', 'verified', 'reverify_needed')`,
    ),
  ],
);

/** Validation records (§7.3). One row per approved stage; bound to a profile version. */
export const validations = pgTable(
  'validations',
  {
    id: id(),
    companyId: companyId(),
    machineProfileVersionId: uuid('machine_profile_version_id').notNull(),
    /** Snapshot of the tool set the validation was done with (§7.3 "sürüm bağlama"). */
    toolSet: jsonb('tool_set').$type<unknown[]>().notNull(),
    postVersion: text('post_version').notNull(),
    stage: validationStage('stage').notNull(),
    level: validationLevel('level').notNull().default('user_approved'),
    /** Caliper measurement form (edges, diagonal, hole diameter, pocket depth). */
    measurements: jsonb('measurements').$type<Record<string, unknown>>().notNull().default({}),
    approvedBy: uuid('approved_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('validations_company_mpv_idx').on(t.companyId, t.machineProfileVersionId),
    foreignKey({
      name: 'validations_mpv_fk',
      columns: [t.companyId, t.machineProfileVersionId],
      foreignColumns: [machineProfileVersions.companyId, machineProfileVersions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'validations_user_fk',
      columns: [t.companyId, t.approvedBy],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/** Offcut stock (§9.1). Sizes in mm; grain 0 | 90 like the project sheet (D-010). */
export const offcuts = pgTable(
  'offcuts',
  {
    id: id(),
    companyId: companyId(),
    material: text('material').notNull(),
    thickness: doublePrecision('thickness').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
    grain: integer('grain'),
    sourceProjectId: uuid('source_project_id'),
    status: offcutStatus('status').notNull().default('available'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('offcuts_company_material_idx').on(t.companyId, t.material, t.thickness),
    foreignKey({
      name: 'offcuts_project_fk',
      columns: [t.companyId, t.sourceProjectId],
      foreignColumns: [projects.companyId, projects.id],
    }),
    check('offcuts_grain', sql`${t.grain} is null or ${t.grain} in (0, 90)`),
    check('offcuts_size_positive', sql`${t.width} > 0 and ${t.height} > 0 and ${t.thickness} > 0`),
  ],
);

/** Project chat history (§5.2). Append-only. */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: id(),
    companyId: companyId(),
    projectId: uuid('project_id').notNull(),
    role: chatRole('role').notNull(),
    content: text('content').notNull(),
    /** Commands the AI proposed (shape of core `CommandLogEntry` without `at`/`actor`). */
    suggestedCommands: jsonb('suggested_commands').$type<unknown[]>().notNull().default([]),
    userId: uuid('user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('chat_company_project_idx').on(t.companyId, t.projectId, t.createdAt),
    foreignKey({
      name: 'chat_project_fk',
      columns: [t.companyId, t.projectId],
      foreignColumns: [projects.companyId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'chat_user_fk',
      columns: [t.companyId, t.userId],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/** AI quota counter (§9.1: şirket, ay, kullanım). One row per company and month. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    companyId: companyId(),
    /** First day of the month (UTC). */
    month: date('month', { mode: 'string' }).notNull(),
    requests: integer('requests').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('ai_usage_company_month_uq').on(t.companyId, t.month),
    check('ai_usage_month_first_day', sql`extract(day from ${t.month}) = 1`),
  ],
);

/** Every tenant table (all but `companies`), keyed by SQL name. Used by tests and helpers. */
export const tenantTables = {
  users,
  machines,
  machine_profile_versions: machineProfileVersions,
  tools,
  materials,
  templates,
  template_versions: templateVersions,
  projects,
  project_commands: projectCommands,
  exports,
  validations,
  offcuts,
  chat_messages: chatMessages,
  ai_usage: aiUsage,
} as const;
