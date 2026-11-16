/**
 * Schema versioning (spec §8.2): old project JSON is upgraded step by step to the latest version
 * and then validated. Pure functions only.
 */
import type { z } from 'zod';
import { LATEST_SCHEMA_VERSION, projectSchema, type Project } from './project';

/** A readable validation problem. `path` is like `parts[0].holes[1].d`; `(root)` for the top level. */
export interface ProjectIssue {
  path: string;
  message: string;
}

export type ParseProjectResult =
  { ok: true; project: Project } | { ok: false; issues: ProjectIssue[] };

/** A step upgrading raw JSON from version `n` to `n + 1`. Steps never see invalid versions. */
export type MigrationStep = (json: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registered steps keyed by the version they upgrade FROM. v1 is the first version, so there are
 * no steps yet. Adding v2 means: bump LATEST_SCHEMA_VERSION, add `1: (json) => ...`, add a test.
 */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

/** Thrown by `migrate` when the JSON cannot be upgraded or does not validate. */
export class ProjectSchemaError extends Error {
  readonly issues: readonly ProjectIssue[];

  constructor(issues: ProjectIssue[]) {
    super(`Invalid project: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'ProjectSchemaError';
    this.issues = issues;
  }
}

/** Formats a Zod path as `a.b[0].c`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out === '' ? '(root)' : out;
}

function toIssues(error: z.ZodError): ProjectIssue[] {
  return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads `schemaVersion` and applies the registered steps up to the latest version. */
function upgrade(
  json: unknown,
): { ok: true; json: Record<string, unknown> } | { ok: false; issues: ProjectIssue[] } {
  if (!isPlainObject(json)) {
    return { ok: false, issues: [{ path: '(root)', message: 'project must be a JSON object' }] };
  }
  const version = json['schemaVersion'];
  if (version === undefined) {
    return { ok: false, issues: [{ path: 'schemaVersion', message: 'schemaVersion is missing' }] };
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      issues: [{ path: 'schemaVersion', message: 'schemaVersion must be an integer >= 1' }],
    };
  }
  if (version > LATEST_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: 'schemaVersion',
          message: `schemaVersion ${version} is newer than this version of NittCam supports (latest is ${LATEST_SCHEMA_VERSION})`,
        },
      ],
    };
  }
  let current = json;
  for (let v = version; v < LATEST_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step === undefined) {
      return {
        ok: false,
        issues: [{ path: 'schemaVersion', message: `no migration registered from version ${v}` }],
      };
    }
    current = { ...step(current), schemaVersion: v + 1 };
  }
  return { ok: true, json: current };
}

/** Upgrades and validates project JSON; never throws. */
export function parseProject(json: unknown): ParseProjectResult {
  const upgraded = upgrade(json);
  if (!upgraded.ok) return upgraded;
  const result = projectSchema.safeParse(upgraded.json);
  if (!result.success) return { ok: false, issues: toIssues(result.error) };
  return { ok: true, project: result.data };
}

/** Upgrades project JSON of any supported version to the latest; throws ProjectSchemaError. */
export function migrate(json: unknown): Project {
  const result = parseProject(json);
  if (!result.ok) throw new ProjectSchemaError(result.issues);
  return result.project;
}
