/**
 * The persisted command log (spec §5.1 "Log", §9.1 `project_commands`, D-029).
 *
 * Besides commands, the log records the history events `undo` and `redo` (params `{}`), so the
 * stored log replays to the saved project: a command applies, `undo` reverts the last applied
 * step, `redo` re-applies the last reverted one, exactly like `CommandStack`.
 */
import { COMMANDS, isCommandName, type CommandStack } from './registry';
import { commandContextSchema, type CommandDefinition, type CommandLogEntry } from './types';

export const HISTORY_EVENTS = ['undo', 'redo'] as const;
export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

export function isHistoryEvent(name: string): name is HistoryEvent {
  return name === 'undo' || name === 'redo';
}

/** Upper bound of one save's log (a paste of 2 000 rows is still one entry). */
export const MAX_LOG_ENTRIES = 5000;

export type ParsedLog = { ok: true; entries: CommandLogEntry[] } | { ok: false; detail: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Checks a log sent by a client: every entry is a registered command with valid params, or a
 * history event with `{}` params, issued by `user` or `ai` at an ISO 8601 time. Pure.
 */
export function parseCommandLog(raw: unknown): ParsedLog {
  if (!Array.isArray(raw)) return { ok: false, detail: 'commands must be an array' };
  if (raw.length > MAX_LOG_ENTRIES) {
    return { ok: false, detail: `at most ${MAX_LOG_ENTRIES} commands per save` };
  }
  const entries: CommandLogEntry[] = [];
  for (const [i, e] of raw.entries()) {
    if (!isPlainObject(e) || typeof e['command'] !== 'string') {
      return { ok: false, detail: `commands[${i}]: not a log entry` };
    }
    const name = e['command'];
    const ctx = commandContextSchema.safeParse({ actor: e['actor'], at: e['at'] });
    if (!ctx.success) return { ok: false, detail: `commands[${i}]: invalid actor or time` };
    if (isHistoryEvent(name)) {
      if (!isPlainObject(e['params']) || Object.keys(e['params']).length > 0) {
        return { ok: false, detail: `commands[${i}]: ${name} takes no params` };
      }
      entries.push({ command: name, params: {}, actor: ctx.data.actor, at: ctx.data.at });
      continue;
    }
    if (!isCommandName(name)) return { ok: false, detail: `commands[${i}]: unknown "${name}"` };
    const def = COMMANDS[name] as CommandDefinition;
    const params = def.params.safeParse(e['params']);
    if (!params.success) return { ok: false, detail: `commands[${i}]: invalid ${name} params` };
    entries.push({ command: name, params: params.data, actor: ctx.data.actor, at: ctx.data.at });
  }
  return { ok: true, entries };
}

/**
 * Replays log entries on a stack (e.g. the unsent queue after a reload, spec §8.2). Stops at the
 * first entry that cannot be applied and returns how many were applied.
 */
export function replayLog(stack: CommandStack, entries: readonly CommandLogEntry[]): number {
  let applied = 0;
  for (const e of entries) {
    let ok: boolean;
    if (e.command === 'undo') ok = stack.undo();
    else if (e.command === 'redo') ok = stack.redo();
    else ok = stack.execute(e.command, e.params, { actor: e.actor, at: e.at }).ok;
    if (!ok) break;
    applied += 1;
  }
  return applied;
}
