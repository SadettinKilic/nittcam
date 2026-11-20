/**
 * NC export on the server (spec §6.6, §7.2 rules 9 and 10, §8.2 "sunucu yetkilidir"; T021, D-030).
 * The file is always regenerated from the **saved** project revision with the profile version the
 * project is bound to; nothing the browser computed is trusted.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  canDownload,
  exportNc,
  findMaterialParams,
  EXPORT_BLOCKING_CODES,
  validateProject,
  needsUnverifiedAcceptance,
  parsePostConfig,
  unverifiedReasons,
  type ExportNcResult,
  type PostFile,
  type ProgramTools,
  type UnverifiedReason,
} from '@nittcam/core';
import type { CompanyScope, ExportRow, MachineWithProfile, ProjectRow } from '@nittcam/db';
import { POST_CONFIGS } from '@nittcam/machines';
import { NextResponse } from 'next/server';
import {
  downloadUrl,
  zipUrl,
  type ExportApiError,
  type ExportChecklistInfo,
  type ExportFileInfo,
  type ExportPostInfo,
  type ExportProfileInfo,
  type ExportRecord,
  type ExportStage,
  type ExportViolation,
} from '../exports-api';
import { fill } from '../draft-project';
import { getMessages } from '../messages';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Bytes of a generated file as stored and served (the post writes ASCII-only text). */
export function fileBytes(file: Pick<PostFile, 'content'>): Uint8Array {
  return new TextEncoder().encode(file.content);
}

/** Hash of an export: sha256 of its `sha256sum`-style manifest, one line per file, in order. */
export function manifestHash(files: readonly { name: string; hash: string }[]): string {
  return sha256Hex(files.map((f) => `${f.hash}  ${f.name}\n`).join(''));
}

export function apiError(body: ExportApiError, status: number): NextResponse<ExportApiError> {
  return NextResponse.json(body, { status });
}

const messages = getMessages();
const texts = messages.simulation;
const validationTexts = messages.wizard.issues.codes as Record<string, string>;

/** Turkish text of an export, check or validation code. */
export function turkish(code: string): string {
  return (
    (texts.codes as Record<string, string>)[code] ??
    validationTexts[code] ??
    fill(texts.codeFallback, { code })
  );
}

/** Every issue of an `exportNc` run, with its stage and Turkish text (CHECK_FAILED copies left out). */
export function violationsOf(r: ExportNcResult): ExportViolation[] {
  const out: ExportViolation[] = [];
  const cutOuts = new Set<string>();
  for (const i of r.toolpathIssues) {
    // T270: one line per cut-out (named by part and number in the UI), not one per copy.
    if (i.inner !== undefined || i.hole !== undefined || i.openLine !== undefined) {
      const key = `${i.code}/${i.partId ?? ''}/${i.inner ?? ''}/${i.hole ?? ''}/${i.openLine ?? ''}`;
      if (cutOuts.has(key)) continue;
      cutOuts.add(key);
    }
    out.push({
      stage: 'toolpath',
      rule: 'TOOLPATH',
      code: i.code,
      severity: i.severity,
      message: turkish(i.code),
      ...(i.sheet !== undefined ? { sheet: i.sheet } : {}),
      ...(i.partId !== null ? { partId: i.partId } : {}),
      ...(i.inner !== undefined ? { inner: i.inner } : {}),
      ...(i.hole !== undefined ? { hole: i.hole } : {}),
      ...(i.openLine !== undefined ? { openLine: i.openLine } : {}),
    });
  }
  for (const i of [...r.postErrors, ...r.postWarnings]) {
    if (i.code === 'CHECK_FAILED' && r.check !== null) continue;
    out.push({
      stage: 'post',
      rule: i.rule ? `R${i.rule}` : 'POST',
      code: i.code,
      severity: i.severity,
      message: turkish(i.code),
      ...(i.sheet !== undefined ? { sheet: i.sheet } : {}),
    });
  }
  for (const v of r.check?.violations ?? []) {
    out.push({
      stage: 'check',
      rule: v.rule,
      code: v.code,
      severity: v.severity,
      message: turkish(v.code),
      line: v.line,
      ...(v.file ? { file: v.file } : {}),
    });
  }
  return out;
}

/**
 * Part id and cut-out (T270) or hole (T275) index of a `parts[i].inners[k]` / `parts[i].holes[h]`
 * validation path.
 */
function cutOutOf(
  data: { parts: readonly { id: string }[] },
  path: string,
):
  | { partId: string; inner: number }
  | { partId: string; hole: number }
  | { partId: string; openLine: number }
  | undefined {
  const m = /^parts\[(\d+)\]\.(inners|holes|lines)\[(\d+)\]/.exec(path);
  const part = m ? data.parts[Number(m[1])] : undefined;
  if (!m || !part) return undefined;
  const k = Number(m[3]);
  if (m[2] === 'inners') return { partId: part.id, inner: k };
  return m[2] === 'holes' ? { partId: part.id, hole: k } : { partId: part.id, openLine: k };
}

/** Sheet index of a `layout.sheets[s]...` validation path. */
function sheetOf(path: string): number | undefined {
  const m = /^layout\.sheets\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : undefined;
}

function profileProblem(code: string): ExportViolation {
  return { stage: 'profile', rule: 'INPUT', code, severity: 'error', message: turkish(code) };
}

/**
 * What an export is generated from: the saved project at one revision, either the stored project
 * (current revision) or the snapshot kept with an earlier export (T179, D-066).
 */
export type ExportSource = Pick<ProjectRow, 'id' | 'name' | 'revision' | 'data'>;

export interface ExportRun {
  project: ExportSource;
  /** The profile version the export uses, or null when it could not be loaded. */
  machine: MachineWithProfile | null;
  latestVersion: number;
  post: ExportPostInfo | null;
  /** Files only when every stage and check passed (rule 9). */
  files: PostFile[];
  ok: boolean;
  stage: ExportStage;
  violations: ExportViolation[];
  needsAcceptance: boolean;
  unverifiedReasons: UnverifiedReason[];
  checklist: ExportChecklistInfo | null;
}

export type RunResult =
  | { kind: 'notFound' }
  | { kind: 'conflict'; currentRevision: number }
  | { kind: 'run'; run: ExportRun };

/**
 * Loads the saved project at `revision` (409 when it is not the current one) and the profile
 * version (`profileVersionId` of the project's machine, else the version stored on the project),
 * then runs `exportNc` with the real project name and revision.
 */
export async function runExport(
  scope: CompanyScope,
  projectId: string,
  revision: number,
  profileVersionId?: string,
): Promise<RunResult> {
  const project = await scope.projects.get(projectId);
  if (!project || project.deletedAt !== null) return { kind: 'notFound' };
  if (project.revision !== revision) {
    return { kind: 'conflict', currentRevision: project.revision };
  }
  return { kind: 'run', run: await runExportOf(scope, project, profileVersionId) };
}

/**
 * The NC pipeline for one export source (T179: also a snapshot of an earlier revision): the
 * profile version (`profileVersionId`, else the one the project stores), every blocking validation
 * error, `exportNc` and its checks. Files only when everything passed (rule 9).
 */
export async function runExportOf(
  scope: CompanyScope,
  project: ExportSource,
  profileVersionId?: string,
): Promise<ExportRun> {
  const data = project.data;
  const machineId = data.machine.machineId;
  const machine = await scope.machines.getProfileVersion(
    machineId,
    profileVersionId ? { id: profileVersionId } : { version: data.machine.profileVersion },
  );
  const latest = await scope.machines.getWithProfile(machineId);
  const base = {
    project,
    machine,
    latestVersion: latest?.version.version ?? 0,
    files: [] as PostFile[],
    ok: false,
    needsAcceptance: true,
    unverifiedReasons: [] as UnverifiedReason[],
    checklist: null,
  };
  if (!machine) {
    const code = latest ? 'PROFILE_VERSION_NOT_FOUND' : 'MACHINE_NOT_FOUND';
    return { ...base, post: null, stage: 'profile', violations: [profileProblem(code)] };
  }
  const raw = POST_CONFIGS[machine.profile.post.id];
  const cfg = raw === undefined ? null : parsePostConfig(raw);
  if (!cfg?.ok) {
    return { ...base, post: null, stage: 'profile', violations: [profileProblem('UNKNOWN_POST')] };
  }
  const post = { id: cfg.config.id, version: cfg.config.version, name: cfg.config.name };
  // Every blocking validation error stops the export (defense in depth, spec §8.2 "sunucu
  // yetkilidir"): the server never relies on the client's validation panel. A copy its grain no
  // longer allows (D-034 amendment) is never cut: the toolpath itself accepts any rotation (D-034
  // stage 1), so that gate is only here; invalid cut-outs are refused by the toolpath as well.
  const blocking = validateProject(data, { machine: machine.profile }).filter(
    (i) => i.severity === 'error',
  );
  if (blocking.length > 0) {
    return {
      ...base,
      post,
      stage: 'toolpath',
      violations: blocking.map((i): ExportViolation => {
        const sheet = sheetOf(i.path);
        const cutOut = cutOutOf(data, i.path);
        return {
          stage: 'toolpath',
          rule: EXPORT_BLOCKING_CODES.has(i.code) ? 'LAYOUT' : 'TOOLPATH',
          code: i.code,
          severity: 'error',
          message: turkish(i.code),
          ...(sheet !== undefined ? { sheet } : {}),
          ...(cutOut ?? {}),
        };
      }),
    };
  }
  const pv = {
    profile: machine.profile,
    version: machine.version.version,
    verification: machine.state,
  };
  const r = exportNc(data, pv, raw, { projectName: project.name, revision: project.revision });
  const ok = r.ok && r.check !== null && canDownload(r.check) && r.files.length > 0;
  return {
    ...base,
    post,
    files: ok ? r.files : [],
    ok,
    stage: r.stage,
    violations: violationsOf(r),
    needsAcceptance: needsUnverifiedAcceptance(pv, cfg.config),
    unverifiedReasons: unverifiedReasons(pv, cfg.config),
    checklist: checklistOf(machine, data, r.tools),
  };
}

/**
 * T274: the tools come from the toolpath that produced the file, in order of use (the sheet with
 * the most tool runs; every sheet program follows the same order rule). Falls back to the material
 * setting's tool only when the pipeline stopped before a toolpath.
 */
function checklistOf(
  machine: MachineWithProfile,
  data: ProjectRow['data'],
  program: ProgramTools | null,
): ExportChecklistInfo {
  const p = machine.profile;
  let tools: ExportChecklistInfo['tools'];
  if (program && program.sheets.length > 0) {
    const longest = program.sheets.reduce((a, b) => (b.tools.length > a.tools.length ? b : a));
    tools = longest.tools.map((t) => ({ number: t.number, diameter: t.diameter, type: t.type }));
  } else {
    const params = findMaterialParams(p, data.stock);
    tools = params
      ? p.tools
          .filter((t) => t.number === params.tool)
          .map((t) => ({ number: t.number, diameter: t.diameter, type: t.type }))
      : [];
  }
  return {
    origin: {
      corner: p.origin.corner,
      xPositive: p.origin.xPositive,
      yPositive: p.origin.yPositive,
      sheetOffset: { ...p.origin.sheetOffset },
    },
    zReference: p.zZero.reference,
    tools,
    toolChanges: program?.manualChanges ?? 0,
    rezeroZ: program?.rezeroZ ?? false,
  };
}

export function profileInfo(run: ExportRun): ExportProfileInfo | null {
  const m = run.machine;
  if (!m) return null;
  return {
    machineId: m.machine.id,
    machineName: m.profile.identity.name,
    profileVersionId: m.version.id,
    version: m.version.version,
    latestVersion: run.latestVersion,
    verification: m.state,
    example: m.profile.example,
  };
}

export function fileInfos(files: readonly PostFile[]): ExportFileInfo[] {
  return files.map((f) => {
    const bytes = fileBytes(f);
    return { name: f.name, size: bytes.byteLength, hash: sha256Hex(bytes), sheet: f.sheet };
  });
}

/** The stored export as the API returns it. */
export function toRecord(row: ExportRow, profileVersion: number | null): ExportRecord {
  return {
    exportId: row.id,
    kind: row.kind,
    projectId: row.projectId,
    revision: row.projectRevision,
    createdAt: row.createdAt.toISOString(),
    profileVersionId: row.machineProfileVersionId,
    profileVersion,
    post: { id: row.postId, version: row.postVersion },
    verification: row.verificationState,
    unverified: row.unverified,
    acceptedUnverifiedAt: row.acceptedUnverifiedAt?.toISOString() ?? null,
    hash: row.sha256,
    files: row.files.map((f) => ({
      name: f.name,
      size: f.size,
      hash: f.sha256,
      sheet: f.sheet,
      downloadUrl: downloadUrl(row.id, f.name),
    })),
    zipUrl: row.files.length > 1 ? zipUrl(row.id) : null,
    stateChanged: false,
  };
}

/**
 * Ids of the exports whose verification state differs from an earlier export of the same revision
 * and type (E6, D-060): those are the "doğrulama durumu değişti" records.
 */
export function stateChangedIds(rows: readonly ExportRow[]): Set<string> {
  const out = new Set<string>();
  const byAge = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const seen = new Map<string, Set<string>>();
  for (const r of byAge) {
    const key = `${r.projectRevision}/${r.kind}/${r.postId}`;
    const states = seen.get(key);
    if (states && !states.has(r.verificationState)) out.add(r.id);
    seen.set(key, new Set([...(states ?? []), r.verificationState]));
  }
  return out;
}

/** Profile version id → version number, for the history rows. */
export async function versionNumbers(scope: CompanyScope): Promise<Map<string, number>> {
  const rows = await scope.machineProfileVersions.list();
  return new Map(rows.map((r) => [r.id, r.version]));
}

/** The stage stored in `validation_stage` (§7.3); "re-verify needed" means not verified any more. */
export function storedStage(state: MachineWithProfile['state']) {
  return state === 'reverify_needed' ? 'draft' : state;
}

export const newExportId = (): string => randomUUID();

/** Storage folder of an export's files. */
export const exportFolder = (exportId: string): string => `exports/${exportId}`;
