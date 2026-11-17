/**
 * NC export pipeline (spec §6.6, §7.2 rule 9; T019, D-027): toolpath → G-code → automatic checks.
 * Files come back **only** when every step passed; the web route and the export record are T021.
 * Pure: same input, same output.
 */
import {
  checkGcodeFiles,
  expectedLayouts,
  type ExpectedPart,
  type GcodeCheckFilesResult,
  type GcodeCheckPostExpectations,
} from '../gcode-check';
import {
  generateGcode,
  parsePostConfig,
  type PostFile,
  type PostIssue,
  type PostMeta,
  type PostProfileVersion,
} from '../post';
import type { Project } from '../schema';
import {
  buildToolpath,
  type Toolpath,
  type ToolpathIssue,
  type ToolpathOptions,
} from '../toolpath';

export interface ExportNcOptions {
  /** Header and file name; default "NittCam". */
  projectName?: string;
  /** Saved project revision; default 0. */
  revision?: number;
  fileStem?: string;
  toolpath?: ToolpathOptions;
}

export type ExportNcStage = 'toolpath' | 'post' | 'check' | 'done';

export interface ExportNcResult {
  /** True only when the toolpath, the post and every check passed. */
  ok: boolean;
  /** Where it stopped (`done` when ok). */
  stage: ExportNcStage;
  /** Empty unless `ok`. */
  files: PostFile[];
  toolpathIssues: ToolpathIssue[];
  postErrors: PostIssue[];
  postWarnings: PostIssue[];
  /** Result of the automatic checks (null when the pipeline stopped before them). */
  check: GcodeCheckFilesResult | null;
}

/** Runs the whole pipeline; any failed step → no files. */
export function exportNc(
  project: Project,
  profileVersion: PostProfileVersion,
  post: unknown,
  options: ExportNcOptions = {},
): ExportNcResult {
  const profile = profileVersion.profile;
  const tp = buildToolpath(project, profile, options.toolpath ?? {});
  const toolpathIssues = [...tp.errors, ...tp.warnings];
  if (!tp.ok) {
    return {
      ok: false,
      stage: 'toolpath',
      toolpathIssues,
      files: [],
      postErrors: [],
      postWarnings: [],
      check: null,
    };
  }
  return postAndCheck(tp.toolpath, toolpathIssues, profileVersion, post, {
    projectName: options.projectName ?? 'NittCam',
    revision: options.revision ?? 0,
    ...(options.fileStem ? { fileStem: options.fileStem } : {}),
    stock: {
      material: project.stock.material,
      thickness: project.stock.thickness,
      sheetWidth: project.stock.sheet.width,
      sheetHeight: project.stock.sheet.height,
    },
    layout: expectedLayouts(project),
  });
}

/** What `postAndCheck` needs besides the toolpath: the post meta plus the expected layout. */
export interface PostAndCheckMeta extends PostMeta {
  /** Expected parts per sheet; null = the layout check is skipped (no through cuts expected). */
  layout: ReadonlyMap<number, readonly ExpectedPart[]> | null;
}

/**
 * The post and check half of the pipeline (rule 9): an already built toolpath → G-code → the
 * automatic checks. Files come back only when both passed. Used by `exportNc` and by the test
 * programs (T022), so every generated program goes through the same post and the same checks.
 */
export function postAndCheck(
  toolpath: Toolpath,
  toolpathIssues: ToolpathIssue[],
  profileVersion: PostProfileVersion,
  post: unknown,
  meta: PostAndCheckMeta,
): ExportNcResult {
  const profile = profileVersion.profile;
  const base = { files: [], postErrors: [], postWarnings: [], check: null };
  const cfg = parsePostConfig(post);
  // An invalid config is refused by the generator itself; the checks only need its declarations.
  const expectations: GcodeCheckPostExpectations | undefined = cfg.ok ? cfg.config : undefined;
  const { layout, ...postMeta } = meta;
  const stock = {
    thickness: meta.stock.thickness,
    sheetWidth: meta.stock.sheetWidth,
    sheetHeight: meta.stock.sheetHeight,
  };
  const context = {
    profile,
    verification: profileVersion.verification,
    ...(expectations ? { post: expectations } : {}),
    toolpath,
    stock,
    ...(layout ? { layout } : {}),
  };
  let checked: { files: readonly PostFile[]; result: GcodeCheckFilesResult } | null = null;
  const run = (files: readonly PostFile[]) => {
    const result = checkGcodeFiles(files, context);
    checked = { files: files.map((f) => ({ ...f })), result };
    return result;
  };

  const gen = generateGcode(toolpath, profileVersion, post, postMeta, {
    check: (files) =>
      run(files).violations.map((v) => ({
        code: 'CHECK_FAILED' as const,
        severity: v.severity,
        rule: 9,
        message: `[${v.rule} ${v.code}] ${v.file ?? ''}:${v.line} ${v.message}`,
      })),
  });
  const prev = checked as { files: readonly PostFile[]; result: GcodeCheckFilesResult } | null;
  if (!gen.ok) {
    return {
      ok: false,
      stage: prev && !prev.result.ok ? 'check' : 'post',
      toolpathIssues,
      ...base,
      postErrors: gen.errors,
      postWarnings: gen.warnings,
      check: prev?.result ?? null,
    };
  }
  // Defence in depth: the files handed out are the files that were checked (re-check otherwise).
  const same =
    prev !== null &&
    prev.files.length === gen.files.length &&
    prev.files.every(
      (f, i) => f.name === gen.files[i]?.name && f.content === gen.files[i]?.content,
    );
  const result = same && prev ? prev.result : checkGcodeFiles(gen.files, context);
  if (!result.ok) {
    return {
      ok: false,
      stage: 'check',
      toolpathIssues,
      ...base,
      postErrors: gen.errors,
      postWarnings: gen.warnings,
      check: result,
    };
  }
  return {
    ok: true,
    stage: 'done',
    files: gen.files,
    toolpathIssues,
    postErrors: [],
    postWarnings: gen.warnings,
    check: result,
  };
}

/**
 * Why a program for this profile version and post carries the "DOĞRULANMADI, önce air cut" header
 * (spec §7.2 rule 10; same rule as the generator and the checks, D-025): `profile` = the profile
 * version is not verified (§7.3), `example` = it is the example profile, `post` = the post config
 * is not verified (or its status is unknown). Empty = no header, no acceptance needed (T022).
 */
export type UnverifiedReason = 'profile' | 'example' | 'post';

export function unverifiedReasons(
  profileVersion: Pick<PostProfileVersion, 'profile' | 'verification'>,
  post: { status?: unknown } | null | undefined,
): UnverifiedReason[] {
  const out: UnverifiedReason[] = [];
  if (profileVersion.verification !== 'verified') out.push('profile');
  if (profileVersion.profile.example) out.push('example');
  if (post?.status !== 'verified') out.push('post');
  return out;
}

/**
 * Does an export with this profile version and post carry the "DOĞRULANMADI, önce air cut" header
 * and so need the user's acceptance before download (spec §7.2 rule 10)? Same rule as the
 * generator's header: the profile version is not verified, is the example profile, or the post is
 * not verified. A post whose status is unknown counts as unverified.
 */
export function needsUnverifiedAcceptance(
  profileVersion: Pick<PostProfileVersion, 'profile' | 'verification'>,
  post: { status?: unknown } | null | undefined,
): boolean {
  return unverifiedReasons(profileVersion, post).length > 0;
}
