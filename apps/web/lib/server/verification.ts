/**
 * Machine verification on the server (spec §7.3; T022, D-031). The air-cut and test-cut programs
 * are generated here from the machine's **latest** profile version, through the same post and the
 * same automatic checks as every export; the browser never supplies G-code or a state.
 */
import {
  canRecordVerification,
  evaluateTestCut,
  evaluateTrayCut,
  trayTestProgram,
  extendedTestProgram,
  parsePostConfig,
  testCutStage,
  testProgram,
  unverifiedReasons,
  vacuumByHand,
  type ExtendedProgramResult,
  type PostConfig,
  type TestCutMeasurements,
  type TestCutSuggestion,
  type TestProgramKind,
  type TestProgramResult,
  type TrayProgramResult,
  type VerificationFamily,
  type VerificationStage,
} from '@nittcam/core';
import type { CompanyScope, MachineWithProfile } from '@nittcam/db';
import { POST_CONFIGS } from '@nittcam/machines';
import { NextResponse } from 'next/server';
import { fileInfos, turkish, violationsOf } from './exports';
import {
  testProgramUrl,
  type ProgramKind,
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

export const PROGRAM_KINDS: readonly ProgramKind[] = [
  'airCut',
  'testCut',
  'extAirCut',
  'extTestCut',
  'acmAirCut',
  'acmTestCut',
];

/** T356: the verification families the page and the API offer (aluminium's part comes with MB7). */
export const PAGE_FAMILIES = [
  'woodBoard',
  'composite',
] as const satisfies readonly VerificationFamily[];
export type PageFamily = (typeof PAGE_FAMILIES)[number];

export function isPageFamily(v: unknown): v is PageFamily {
  return (PAGE_FAMILIES as readonly unknown[]).includes(v);
}

/** T356: the family a program kind verifies (`acm*` = composite; the rest = wood board). */
export function familyOfKind(kind: ProgramKind): PageFamily {
  return kind === 'acmAirCut' || kind === 'acmTestCut' ? 'composite' : 'woodBoard';
}

export function isProgramKind(v: string): v is ProgramKind {
  return (PROGRAM_KINDS as readonly string[]).includes(v);
}

export interface MachineContext {
  /** `state` is the machine's state in `family` (T356). */
  machine: MachineWithProfile;
  family: PageFamily;
  /** Raw post config (the generator validates it again) and its parsed form, or null if unknown. */
  rawPost: unknown;
  post: PostConfig | null;
}

/** The machine with its latest profile version and its post config; null when not found. */
export async function loadMachine(
  scope: CompanyScope,
  machineId: string,
  family: PageFamily = 'woodBoard',
): Promise<MachineContext | null> {
  const found = await scope.machines.getWithProfile(machineId);
  if (!found) return null;
  const machine = { ...found, state: found.families[family] };
  const rawPost = POST_CONFIGS[machine.profile.post.id];
  const parsed = rawPost === undefined ? null : parsePostConfig(rawPost);
  return { machine, family, rawPost, post: parsed?.ok ? parsed.config : null };
}

/** The §7.3 program kind behind a program kind (the extended part has the same two). */
function baseKind(kind: ProgramKind): TestProgramKind {
  return kind === 'extAirCut' || kind === 'acmAirCut'
    ? 'airCut'
    : kind === 'extTestCut' || kind === 'acmTestCut'
      ? 'testCut'
      : kind;
}

function profileVersionOf(ctx: MachineContext) {
  const m = ctx.machine;
  return { profile: m.profile, version: m.version.version, verification: m.state };
}

/** Runs one §7.3 test program for the machine's latest profile version. */
export function runProgram(ctx: MachineContext, kind: TestProgramKind): TestProgramResult {
  return testProgram(kind, profileVersionOf(ctx), ctx.rawPost);
}

/** Runs any downloadable program: the §7.3 pair or the extended field-test part (T191). */
export function runAnyProgram(
  ctx: MachineContext,
  kind: ProgramKind,
): TestProgramResult | ExtendedProgramResult | TrayProgramResult {
  if (kind === 'acmAirCut' || kind === 'acmTestCut') {
    // T356: the ACM tray, with the machine's composite family state (header and acceptance).
    return trayTestProgram(baseKind(kind), profileVersionOf(ctx), ctx.rawPost);
  }
  return kind === 'extAirCut' || kind === 'extTestCut'
    ? extendedTestProgram(baseKind(kind), profileVersionOf(ctx), ctx.rawPost)
    : runProgram(ctx, kind);
}

/** May the program be downloaded in this state? The test cut needs an approved air cut. */
export function programAllowed(ctx: MachineContext, kind: ProgramKind): boolean {
  // The extended part is cut after the §7.3 air cut, like the test part (§7.3 order).
  return baseKind(kind) === 'airCut' || canRecordVerification(ctx.machine.state, 'testCut');
}

/**
 * Does the program of this kind generate for the latest profile version and pass every automatic
 * check (rule 9)? A step may only be approved for a program the user could actually download.
 */
export function programPasses(ctx: MachineContext, kind: ProgramKind): boolean {
  if (ctx.post === null) return false;
  const r = runAnyProgram(ctx, kind);
  return r.ok && r.check !== null && r.check.ok && r.files.length > 0;
}

function preview(ctx: MachineContext, kind: ProgramKind): TestProgramPreview {
  const r = runAnyProgram(ctx, kind);
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

/** T309 (D-097): the park point the programs use, or null (off, no manual change, no G53). */
export function parkPoint(
  profile: MachineWithProfile['profile'],
  post: PostConfig | null,
): { x: number; y: number } | null {
  const park = profile.toolChanger.park;
  if (!park?.enabled || post?.toolChange.mode !== 'manual') return null;
  if (post.motion.machineCoordinates !== true) return null;
  return { x: park.x, y: park.y };
}

export async function overview(
  scope: CompanyScope,
  ctx: MachineContext,
): Promise<VerificationOverview> {
  const m = ctx.machine;
  const tray = ctx.family === 'composite';
  const air = preview(ctx, tray ? 'acmAirCut' : 'airCut');
  const cut = preview(ctx, tray ? 'acmTestCut' : 'testCut');
  const info = tray ? null : runProgram(ctx, 'testCut').info;
  const trayInfo = tray ? runAnyProgram(ctx, 'acmTestCut').info : null;
  const history = await scope.machines.verificationHistory(m.machine.id);
  const downloads = (await scope.machines.testDownloads(m.machine.id)) ?? [];
  return {
    machineId: m.machine.id,
    machineName: m.profile.identity.name,
    profileVersionId: m.version.id,
    version: m.version.version,
    state: m.state,
    family: ctx.family,
    families: { woodBoard: m.families.woodBoard, composite: m.families.composite },
    tray: trayInfo && 'foldedOuter' in trayInfo ? trayInfo : null,
    example: m.profile.example,
    post: ctx.post ? { id: ctx.post.id, version: ctx.post.version, name: ctx.post.name } : null,
    unverifiedReasons: unverifiedReasons({ profile: m.profile, verification: m.state }, ctx.post),
    testPart: info,
    origin: { corner: m.profile.origin.corner, sheetOffset: { ...m.profile.origin.sheetOffset } },
    park: parkPoint(m.profile, ctx.post),
    parkOff: ctx.post?.toolChange.mode === 'manual' && parkPoint(m.profile, ctx.post) === null,
    // T336: a vacuum machine whose programs write no vacuum code.
    ...(ctx.post && vacuumByHand(m.profile, ctx.post) ? { vacuumByHand: true as const } : {}),
    programs: { airCut: air, testCut: cut },
    extended: {
      info: extendedTestProgram('testCut', profileVersionOf(ctx), ctx.rawPost).info,
      airCut: preview(ctx, 'extAirCut'),
      testCut: preview(ctx, 'extTestCut'),
    },
    downloads: downloads.map((d) => ({ ...d, kind: d.kind as ProgramKind })),
    // T356: the history of this family only (wood board: the records without a family).
    history: history
      .filter((h) => (h.validation.materialFamily ?? 'woodBoard') === ctx.family)
      .map(historyItem),
  };
}

/** Evaluates a test-cut form for the machine's test part; null when the part cannot be made. */
export function evaluate(ctx: MachineContext, measurements: Record<string, unknown>) {
  if (ctx.family === 'composite') {
    // T356: the ACM tray: remaining skin and folded outer size.
    const r = runAnyProgram(ctx, 'acmTestCut');
    const info = r.info && 'foldedOuter' in r.info ? r.info : null;
    if (!info) return null;
    const ev = evaluateTrayCut(measurements, info);
    const evaluation = { ...ev, suggestions: [] as TestCutSuggestion[] };
    return { info, evaluation, stage: testCutStage(ev.inTolerance), keys: TRAY_KEYS };
  }
  const info = runProgram(ctx, 'testCut').info;
  if (!info) return null;
  const evaluation = evaluateTestCut(
    measurements as Partial<Record<keyof TestCutMeasurements, unknown>>,
    info,
  );
  return { info, evaluation, stage: testCutStage(evaluation.inTolerance), keys: BOARD_KEYS };
}

/** The measurement keys stored with a recorded test cut, per family. */
const BOARD_KEYS = ['edgeX', 'edgeY', 'diagonal', 'holeDiameter', 'pocketDepth', 'thickness'];
const TRAY_KEYS = ['remaining', 'outerX', 'outerY'];
