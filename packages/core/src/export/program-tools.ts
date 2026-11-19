/**
 * Tools of a program in order of use, taken from the toolpath the files are generated from
 * (T274, spec §6.5 checklist, §7.2). Pure. The independent reader keeps its own copy of the
 * tool-run rule (it must not import this).
 */
import type { MachineProfile } from '../machine';
import type { PostConfig } from '../post';
import type { Toolpath } from '../toolpath';

export interface ProgramTool {
  number: number;
  /** mm, as the toolpath used it. */
  diameter: number;
  /** Tool type of the machine profile ('' when the profile lacks the number). */
  type: string;
}

export interface ProgramTools {
  /** Per sheet with operations, in sheet order: tool runs in order of use (a tool repeats when it comes back). */
  sheets: { sheet: number; tools: ProgramTool[] }[];
  /** Tool-change mode of the post. */
  mode: 'auto' | 'manual' | 'none';
  /**
   * Operator stops for a tool change inside one program (manual mode; the first-tool question is
   * not counted). The largest count over the sheets; 0 otherwise.
   */
  manualChanges: number;
  /** True when a manual change has no tool length offset: Z must be re-zeroed after each change. */
  rezeroZ: boolean;
}

export function programTools(
  toolpath: Toolpath,
  profile: MachineProfile,
  post: Pick<PostConfig, 'toolChange'> | null,
): ProgramTools {
  const types = new Map(profile.tools.map((t) => [t.number, t.type as string]));
  const bySheet = new Map<number, ProgramTool[]>();
  for (const op of toolpath.operations) {
    const runs = bySheet.get(op.sheet) ?? [];
    if (runs[runs.length - 1]?.number !== op.tool) {
      runs.push({ number: op.tool, diameter: op.toolDiameter, type: types.get(op.tool) ?? '' });
    }
    bySheet.set(op.sheet, runs);
  }
  const sheets = [...bySheet.keys()]
    .sort((a, b) => a - b)
    .map((sheet) => ({ sheet, tools: bySheet.get(sheet) ?? [] }));
  const mode = post?.toolChange.mode ?? 'auto';
  const changes = sheets.reduce((n, s) => Math.max(n, s.tools.length - 1), 0);
  const manualChanges = mode === 'manual' ? changes : 0;
  const offset =
    post !== null && post.toolChange.lengthOffset && profile.toolChanger.lengthCompensation;
  return { sheets, mode, manualChanges, rezeroZ: manualChanges > 0 && !offset };
}
