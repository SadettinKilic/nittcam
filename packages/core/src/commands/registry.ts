/**
 * Command registry, pure apply and the undo/redo stack (spec §5.1).
 * Every change to project data goes through `applyCommand` (or `CommandStack.execute`).
 */
import { Immer, enablePatches, type Patch } from 'immer';
import { z } from 'zod';
import { formatPath, projectSchema, type Project } from '../schema';
import { validateProject, type ValidationContext, type ValidationIssue } from '../validate';
import { addPart, duplicatePart, importCutList, removePart, updatePart } from './part';
import { setMachine, setMaterial, setSheetSize, setThickness } from './plate';
import {
  commandContextSchema,
  type CommandContext,
  type CommandDefinition,
  type CommandError,
  type CommandLogEntry,
} from './types';

enablePatches();
/** Private Immer instance so core never changes the global Immer configuration. */
const immer = new Immer({ autoFreeze: true });

/** All registered commands by name. */
export const COMMANDS = {
  setMachine,
  setMaterial,
  setThickness,
  setSheetSize,
  addPart,
  updatePart,
  removePart,
  duplicatePart,
  importCutList,
} as const satisfies Record<string, CommandDefinition>;

export type CommandName = keyof typeof COMMANDS;
/** Params as the caller passes them (defaults may be omitted). */
export type CommandParams<N extends CommandName> = z.input<(typeof COMMANDS)[N]['params']>;

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

export interface AppliedCommand {
  ok: true;
  project: Project;
  /** Parsed params (defaults applied); what the log stores. */
  params: unknown;
  patches: Patch[];
  inversePatches: Patch[];
}

export type ApplyResult = AppliedCommand | { ok: false; error: CommandError };

function zodIssues(error: z.ZodError, prefix: PropertyKey[]): CommandError['issues'] {
  return error.issues.map((i) => ({
    path: formatPath([...prefix, ...i.path]),
    message: i.message,
  }));
}

/**
 * Pure: validates params, checks preconditions, applies the command and returns the new project
 * with forward and inverse patches. The input project is never mutated. A command whose result
 * would not pass the project schema is rejected, so commands cannot produce an invalid project.
 */
export function applyCommand(project: Project, name: string, rawParams: unknown): ApplyResult {
  if (!isCommandName(name)) {
    return {
      ok: false,
      error: { code: 'UNKNOWN_COMMAND', message: `unknown command "${name}"`, issues: [] },
    };
  }
  const def = COMMANDS[name] as CommandDefinition;
  const parsed = def.params.safeParse(rawParams);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PARAMS',
        message: `invalid params for ${name}`,
        issues: zodIssues(parsed.error, ['params']),
      },
    };
  }
  const params = parsed.data;
  const problem = def.check?.(project, params);
  if (problem !== undefined) {
    return {
      ok: false,
      error: { code: 'PRECONDITION_FAILED', message: `${name}: ${problem}`, issues: [] },
    };
  }
  const [next, patches, inversePatches] = immer.produceWithPatches(project, (draft) => {
    def.apply(draft, params);
  });
  const check = projectSchema.safeParse(next);
  if (!check.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_RESULT',
        message: `${name} would make the project invalid`,
        issues: zodIssues(check.error, []),
      },
    };
  }
  return { ok: true, project: next, params, patches, inversePatches };
}

/** Applies stored patches (redo with `patches`, undo with `inversePatches`). Pure. */
export function applyPatches(project: Project, patches: readonly Patch[]): Project {
  return immer.applyPatches(project, patches as Patch[]);
}

/** One undoable step: the log entry plus the patches to replay it either way. */
export interface HistoryStep {
  entry: CommandLogEntry;
  patches: Patch[];
  inversePatches: Patch[];
}

export type ExecuteResult =
  | {
      ok: true;
      project: Project;
      entry: CommandLogEntry;
      issues: ValidationIssue[];
      /** False when the command changed nothing and therefore left no history (no undo step, no log entry). */
      changed: boolean;
    }
  | { ok: false; error: CommandError };

/**
 * Undo/redo history around a project. Holds no clock: the caller passes `{ actor, at }` with
 * every command. Executing a command after an undo clears the redo stack. A rejected command
 * changes nothing (not the project, the stacks or the log).
 */
export class CommandStack {
  private current: Project;
  private currentIssues: ValidationIssue[];
  private readonly undoSteps: HistoryStep[] = [];
  private redoSteps: HistoryStep[] = [];
  private readonly entries: CommandLogEntry[] = [];

  /**
   * @param validation extra data for rule validation (the selected machine profile); without it
   * the tool rules are skipped.
   */
  constructor(
    project: Project,
    private readonly validation: ValidationContext = {},
  ) {
    this.current = project;
    this.currentIssues = validateProject(project, validation);
  }

  get project(): Project {
    return this.current;
  }

  /** Rule validation of the current project; refreshed after execute, undo and redo. */
  get issues(): readonly ValidationIssue[] {
    return this.currentIssues;
  }

  /** Every executed command in order (append-only; undo/redo do not remove or add entries). */
  get log(): readonly CommandLogEntry[] {
    return this.entries;
  }

  get canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  get canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  execute<N extends CommandName>(
    name: N,
    params: CommandParams<N>,
    context: CommandContext,
  ): ExecuteResult;
  execute(name: string, params: unknown, context: CommandContext): ExecuteResult;
  execute(name: string, params: unknown, context: CommandContext): ExecuteResult {
    const ctx = commandContextSchema.safeParse(context);
    if (!ctx.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_CONTEXT',
          message: 'invalid command context',
          issues: zodIssues(ctx.error, ['context']),
        },
      };
    }
    const result = applyCommand(this.current, name, params);
    if (!result.ok) return result;
    const entry: CommandLogEntry = {
      command: name,
      params: result.params,
      actor: ctx.data.actor,
      at: ctx.data.at,
    };
    // A command that changes nothing (e.g. updatePart with the current values) is accepted but
    // records no history: no undo step, no log entry, and the redo stack is kept.
    if (result.patches.length === 0) {
      return { ok: true, project: this.current, entry, issues: this.currentIssues, changed: false };
    }
    this.undoSteps.push({
      entry,
      patches: result.patches,
      inversePatches: result.inversePatches,
    });
    this.redoSteps = [];
    this.entries.push(entry);
    this.setProject(result.project);
    return { ok: true, project: this.current, entry, issues: this.currentIssues, changed: true };
  }

  /** Reverts the last executed (or redone) command. Returns false when there is nothing to undo. */
  undo(): boolean {
    const step = this.undoSteps.pop();
    if (!step) return false;
    this.setProject(applyPatches(this.current, step.inversePatches));
    this.redoSteps.push(step);
    return true;
  }

  /** Re-applies the last undone command. Returns false when there is nothing to redo. */
  redo(): boolean {
    const step = this.redoSteps.pop();
    if (!step) return false;
    this.setProject(applyPatches(this.current, step.patches));
    this.undoSteps.push(step);
    return true;
  }

  private setProject(project: Project): void {
    this.current = project;
    this.currentIssues = validateProject(project, this.validation);
  }
}

/** An AI tool definition generated from a command's params schema (spec §5.1, §5.4). */
export interface CommandToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12) of the params, as the caller may send them (defaults optional). */
  inputSchema: Record<string, unknown>;
}

/**
 * JSON Schema tool definitions for every command the AI may call. Export and machine-profile
 * changes are never included (spec §5.4). Refinements (like r ≤ min(w, h) / 2) are not expressible
 * in JSON Schema; `applyCommand` still enforces them.
 */
export function commandToolDefinitions(): CommandToolDefinition[] {
  return Object.values(COMMANDS as Record<string, CommandDefinition>)
    .filter((def) => def.aiTool)
    .map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: z.toJSONSchema(def.params, { io: 'input' }) as Record<string, unknown>,
    }));
}
