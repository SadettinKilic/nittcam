/**
 * Machine verification on the server (spec §7.3; T022, D-031). The air-cut and test-cut programs
 * are generated here from the machine's **latest** profile version, through the same post and the
 * same automatic checks as every export; the browser never supplies G-code or a state.
 */
import {
  canRecordVerification,
  evaluateTestCut,
  parsePostConfig,
  testCutStage,
  testProgram,
  unverifiedReasons,
  type PostConfig,
  type TestCutMeasurements,
  type TestProgramKind,
  type TestProgramResult,
  type VerificationStage,
} from '@nittcam/core';
import type { CompanyScope, MachineWithProfile } from '@nittcam/db';
import { POST_CONFIGS } from '@nittcam/machines';
import { NextResponse } from 'next/server';
import { fileInfos, turkish, violationsOf } from './exports';
import {
  testProgramUrl,
  type TestProgramPreview,
  type VerificationApiError,
  type VerificationHistoryItem,
  type VerificationOverview,
} from '../verification-api';

export function apiError(
  body: VerificationApiError,
  status: number,
): NextResponse<VerificationApiError> {
  return NextResponse.json(body, { status });
}

export const PROGRAM_KINDS: readonly TestProgramKind[] = ['airCut', 'testCut'];

export function isProgramKind(v: string): v is TestProgramKind {
  return (PROGRAM_KINDS as readonly string[]).includes(v);
}

export interface MachineContext {
  machine: MachineWithProfile;
  /** Raw post config (the generator validates it again) and its parsed form, or null if unknown. */
  rawPost: unknown;
  post: PostConfig | null;
}

/** The machine with its latest profile version and its post config; null when not found. */
export async function loadMachine(
  scope: CompanyScope,
  machineId: string,
): Promise<MachineContext | null> {
  const machine = await scope.machines.getWithProfile(machineId);
  if (!machine) return null;
  const rawPost = POST_CONFIGS[machine.profile.post.id];
  const parsed = rawPost === undefined ? null : parsePostConfig(rawPost);
  return { machine, rawPost, post: parsed?.ok ? parsed.config : null };
}

/** Runs one test program for the machine's latest profile version. */
export function runProgram(ctx: MachineContext, kind: TestProgramKind): TestProgramResult {
  const m = ctx.machine;
  return testProgram(
    kind,
    { profile: m.profile, version: m.version.version, verification: m.state },
    ctx.rawPost,
  );
}

/** May the program be downloaded in this state? The test cut needs an approved air cut. */
export function programAllowed(ctx: MachineContext, kind: TestProgramKind): boolean {
  return kind === 'airCut' || canRecordVerification(ctx.machine.state, 'testCut');
}

/**
 * Does the program of this kind generate for the latest profile version and pass every automatic
 * check (rule 9)? A step may only be approved for a program the user could actually download.
 */
export function programPasses(ctx: MachineContext, kind: TestProgramKind): boolean {
  if (ctx.post === null) return false;
  const r = runProgram(ctx, kind);
  return r.ok && r.check !== null && r.check.ok && r.files.length > 0;
}

function preview(ctx: MachineContext, kind: TestProgramKind): TestProgramPreview {
  const r = runProgram(ctx, kind);
  const ok = r.ok && r.check !== null && r.check.ok && r.files.length > 0;
  const violations = violationsOf(r);
  for (const i of r.issues) {
    violations.unshift({
      stage: 'toolpath',
      rule: 'TOOLPATH',
      code: i.code,
      severity: 'error',
      message: turkish(i.code),
    });
  }
  if (ctx.post === null) {
    violations.unshift({
      stage: 'profile',
      rule: 'INPUT',
      code: 'UNKNOWN_POST',
      severity: 'error',
      message: turkish('UNKNOWN_POST'),
    });
  }
  return {
    kind,
    ok,
    allowed: programAllowed(ctx, kind),
    files: ok
      ? fileInfos(r.files).map((f) => ({
          ...f,
          downloadUrl: testProgramUrl(ctx.machine.machine.id, kind, f.name),
        }))
      : [],
    violations,
  };
}

function historyItem(row: {
  validation: {
    id: string;
    stage: VerificationStage;
    createdAt: Date;
    measurements: Record<string, unknown>;
  };
  version: number;
}): VerificationHistoryItem {
  const m = row.validation.measurements;
  const input =
    m.input && typeof m.input === 'object' ? (m.input as Partial<TestCutMeasurements>) : null;
  const inTolerance = typeof m.inTolerance === 'boolean' ? m.inTolerance : null;
  return {
    id: row.validation.id,
    stage: row.validation.stage,
    version: row.version,
    createdAt: row.validation.createdAt.toISOString(),
    measurements: input,
    inTolerance,
  };
}

export async function overview(
  scope: CompanyScope,
  ctx: MachineContext,
): Promise<VerificationOverview> {
  const m = ctx.machine;
  const air = preview(ctx, 'airCut');
  const cut = preview(ctx, 'testCut');
  const info = runProgram(ctx, 'testCut').info;
  const history = await scope.machines.verificationHistory(m.machine.id);
  return {
    machineId: m.machine.id,
    machineName: m.profile.identity.name,
    profileVersionId: m.version.id,
    version: m.version.version,
    state: m.state,
    example: m.profile.example,
    post: ctx.post ? { id: ctx.post.id, version: ctx.post.version, name: ctx.post.name } : null,
    unverifiedReasons: unverifiedReasons({ profile: m.profile, verification: m.state }, ctx.post),
    testPart: info,
    origin: { corner: m.profile.origin.corner, sheetOffset: { ...m.profile.origin.sheetOffset } },
    programs: { airCut: air, testCut: cut },
    history: history.map(historyItem),
  };
}

/** Evaluates a test-cut form for the machine's test part; null when the part cannot be made. */
export function evaluate(
  ctx: MachineContext,
  measurements: Partial<Record<keyof TestCutMeasurements, unknown>>,
) {
  const info = runProgram(ctx, 'testCut').info;
  if (!info) return null;
  const evaluation = evaluateTestCut(measurements, info);
  return { info, evaluation, stage: testCutStage(evaluation.inTolerance) };
}
