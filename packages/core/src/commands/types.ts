/**
 * Command layer types (spec §5.1). A command = Zod params schema + pure apply on an Immer draft.
 * Undo/redo come from the patches Immer records; the log entry records who, when and what.
 */
import type { Draft } from 'immer';
import { z } from 'zod';
import type { MachineProfile } from '../machine';
import type { Project } from '../schema';

/** Who issued a command (spec §5.1 "kim yaptı"). */
export const actorSchema = z.enum(['user', 'ai'], { error: 'actor must be "user" or "ai"' });
export type Actor = z.infer<typeof actorSchema>;

/**
 * Supplied by the caller for every command. Core never reads the clock (spec §8.2), so `at`
 * (an ISO 8601 date-time string) comes from outside.
 */
export const commandContextSchema = z.strictObject({
  actor: actorSchema,
  at: z.iso.datetime({ offset: true, error: 'at must be an ISO 8601 date-time string' }),
});
export type CommandContext = z.infer<typeof commandContextSchema>;

/**
 * Data from outside the project some preconditions need (T307): the selected machine profile.
 * Without it a machine-dependent check is skipped; the validation and the toolpath still catch it.
 */
export interface CommandEnv {
  machine?: MachineProfile | undefined;
}

/** Where a command lives (`packages/core/src/commands/<area>/`). */
export type CommandArea = 'plate' | 'part' | 'nesting';

/** Definition of one command. `params` is the single source for validation and the AI tool schema. */
export interface CommandDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  area: CommandArea;
  /** English description; becomes the AI tool description. */
  description: string;
  /**
   * Whether the AI may call this command (spec §5.4). Export and machine-profile changes are
   * never AI tools. Selecting a machine (`setMachine`) is allowed.
   */
  aiTool: boolean;
  params: S;
  /**
   * The params the AI may pass, when narrower than `params` (e.g. `runNesting` without the stock
   * offcuts the app loads, T168). The tool definition shows it and an `ai` actor is held to it.
   */
  aiParams?: z.ZodType | undefined;
  /**
   * Optional precondition on the current project (e.g. a free part id). Returns an English
   * message when the command cannot run; `undefined` when it can.
   */
  check?: (project: Project, params: z.output<S>, env: CommandEnv) => string | undefined;
  /** Pure mutation of the draft. No clock, randomness or I/O. */
  apply: (draft: Draft<Project>, params: z.output<S>) => void;
}

/** Identity helper that keeps the params type of a command definition. */
export function defineCommand<S extends z.ZodType>(
  def: CommandDefinition<S>,
): CommandDefinition<S> {
  return def;
}

/** One line of the command log (spec §5.1, later persisted to `project_commands`). */
export interface CommandLogEntry {
  command: string;
  /** Params after schema parsing (defaults applied), so replaying the log is deterministic. */
  params: unknown;
  actor: Actor;
  at: string;
}

export type CommandErrorCode =
  | 'UNKNOWN_COMMAND'
  | 'INVALID_CONTEXT'
  | 'INVALID_PARAMS'
  | 'PRECONDITION_FAILED'
  | 'INVALID_RESULT'
  | 'STALE_BASE';

/** Why a command was rejected. The project is unchanged when this is returned. */
export interface CommandError {
  code: CommandErrorCode;
  message: string;
  /** Field-level problems, paths like `params.w` or `parts[0].id`. */
  issues: { path: string; message: string }[];
}
