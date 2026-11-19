import { readFile } from 'node:fs/promises';
import { expect, type APIRequestContext } from '@playwright/test';
import {
  buildToolpath,
  checkGcodeFiles,
  expectedLayouts,
  parsePostConfig,
  type GcodeCheckFilesResult,
  type MachineProfile,
  type VerificationState,
  type Project,
} from '../../packages/core/src/index';

/** Shared by the end-to-end specs (T024 M1 exit, T137 M4 exit). */
export interface MachineDetail {
  id: string;
  state: VerificationState;
  profile: MachineProfile & { post: { id: string } };
}

/**
 * The independent verification: re-derives the expected toolpath and layout from the SAVED project
 * and the machine profile, then runs the reader + automatic checks over the downloaded bytes.
 */
export async function verifyDownloaded(
  request: APIRequestContext,
  id: string,
  files: { name: string; content: string; sheet: number }[],
): Promise<GcodeCheckFilesResult & { partsCut: number; partsExpected: number }> {
  const detail = (await (await request.get(`/api/projects/${id}`)).json()) as { project: Project };
  const project = detail.project;
  const machine = (await (
    await request.get(`/api/machines/${project.machine.machineId}`)
  ).json()) as MachineDetail;
  const postRaw: unknown = JSON.parse(
    await readFile(
      new URL(`../../packages/machines/${machine.profile.post.id}/v1/post.json`, import.meta.url),
      'utf8',
    ),
  );
  const cfg = parsePostConfig(postRaw);
  if (!cfg.ok) throw new Error('post config invalid');
  const tp = buildToolpath(project, machine.profile, {});
  expect(tp.ok).toBe(true);
  if (!tp.ok) throw new Error('toolpath failed');
  const result = checkGcodeFiles(files, {
    profile: machine.profile,
    verification: machine.state,
    post: cfg.config,
    toolpath: tp.toolpath,
    stock: {
      thickness: project.stock.thickness,
      sheetWidth: project.stock.sheet.width,
      sheetHeight: project.stock.sheet.height,
    },
    layout: expectedLayouts(project),
  });
  const sum = (f: (r: GcodeCheckFilesResult['files'][number]) => number | null) =>
    result.files.reduce((n, r) => n + (f(r) ?? 0), 0);
  return {
    ...result,
    partsCut: sum((r) => r.result.summary.partsCut),
    partsExpected: sum((r) => r.result.summary.partsExpected),
  };
}
