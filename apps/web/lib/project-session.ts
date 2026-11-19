'use client';

import {
  CommandStack,
  replayLog,
  validateProject,
  type AppliedCommand,
  type CommandLogEntry,
  type ExecuteResult,
  type MachineProfile,
  type Project,
  type ValidationIssue,
} from '@nittcam/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutosaveQueue,
  takeUnsentQueue,
  type KeyValueStorage,
  type SaveRequest,
  type SaveState,
  type SendResult,
} from './autosave';
import { FALLBACK_TOOL_DIAMETER } from './draft-project';
import type { ProjectDetail, SaveResponse } from './projects-api';

/** `sessionStorage`, or null where the browser blocks it. */
function sessionStore(): KeyValueStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Sends one autosave request: POST for a new project, PUT with the revision lock otherwise. */
export async function sendSave(req: SaveRequest): Promise<SendResult> {
  let res: Response;
  try {
    res =
      req.id === null
        ? await fetch('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...(req.newId ? { id: req.newId } : {}),
              name: req.name,
              project: req.project,
              commands: req.commands,
            }),
          })
        : await fetch(`/api/projects/${encodeURIComponent(req.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              project: req.project,
              baseRevision: req.baseRevision,
              commands: req.commands,
              name: req.name,
            }),
          });
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (res.status === 409) return { ok: false, kind: 'conflict' };
  if (res.status >= 400 && res.status < 500) return { ok: false, kind: 'invalid' };
  if (!res.ok) return { ok: false, kind: 'server' };
  const body = (await res.json()) as ProjectDetail | SaveResponse;
  return { ok: true, id: body.id, revision: body.revision };
}

export interface SessionInit {
  id: string | null;
  /** Server revision (0 for a project that is not created yet). */
  revision: number;
  name: string;
  project: Project;
}

const now = () => new Date().toISOString();
const history = (command: 'undo' | 'redo'): CommandLogEntry => ({
  command,
  params: {},
  actor: 'user',
  at: now(),
});

/**
 * The project being edited in the wizard: a `CommandStack` (every change is a command, undo and
 * redo included), the autosave queue (debounced save with the revision lock, spec §8.2) and the
 * rule validation with the selected machine (D-016, D-029).
 */
export function useProjectSession({
  initial,
  machine,
  onCreated,
}: {
  initial: SessionInit;
  machine: MachineProfile | null;
  onCreated: (id: string) => void;
}) {
  // A reload before the last save went through: replay the unsent commands of this tab (§8.2).
  const [boot] = useState(() => {
    const stack = new CommandStack(initial.project);
    const stored = takeUnsentQueue(sessionStore(), initial.id, initial.revision);
    const replayed = stored ? stored.entries.slice(0, replayLog(stack, stored.entries)) : [];
    // A new project gets its id here (D-030); after a reload during the first save the stored
    // queue keeps it, so the repeated create returns the same project instead of a duplicate.
    const newId = initial.id === null ? (stored?.newId ?? crypto.randomUUID()) : undefined;
    return { stack, replayed, name: stored?.name ?? initial.name, newId };
  });
  const stack = boot.stack;
  const [, setVersion] = useState(0);
  const [name, setName] = useState(boot.name);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [revision, setRevision] = useState(initial.revision);

  const [queue] = useState(
    () =>
      new AutosaveQueue(
        {
          send: async (req) => {
            const r = await sendSave(req);
            if (r.ok) setRevision(r.revision);
            return r;
          },
          storage: sessionStore(),
          setTimer: (fn, ms) => setTimeout(fn, ms),
          clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
          onState: setSaveState,
        },
        {
          id: initial.id,
          revision: initial.revision,
          name: initial.name,
          project: initial.project,
          ...(boot.newId ? { newId: boot.newId } : {}),
        },
      ),
  );

  useEffect(() => {
    queue.setOnCreated(onCreated);
  }, [queue, onCreated]);

  // Hand the replayed commands (or a renamed draft) to the queue once, after mount.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (boot.replayed.length > 0 || boot.name !== initial.name) {
      queue.push({ entries: boot.replayed, project: stack.project, name: boot.name });
    }
  }, [boot, initial.name, queue, stack]);

  // Leaving the wizard (or the tab going to the background) saves what is pending right away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void queue.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void queue.flush();
    };
  }, [queue]);

  const changed = useCallback(
    (entries: CommandLogEntry[]) => {
      queue.push({ entries, project: stack.project });
      setVersion((v) => v + 1);
    },
    [queue, stack],
  );

  const run = useCallback(
    (command: string, params: unknown): boolean => {
      const result = stack.execute(command, params, { actor: 'user', at: now() });
      if (result.ok && result.changed) changed([result.entry]);
      return result.ok;
    },
    [stack, changed],
  );

  /** Records a command computed in a worker (`runNesting`, D-019). */
  const recordApplied = useCallback(
    (
      command: string,
      applied: Pick<AppliedCommand, 'params' | 'patches' | 'inversePatches'>,
      basedOn: Project,
    ): ExecuteResult => {
      const result = stack.executeApplied(command, applied, { actor: 'user', at: now() }, basedOn);
      if (result.ok && result.changed) changed([result.entry]);
      return result;
    },
    [stack, changed],
  );

  const undo = useCallback(() => {
    if (stack.undo()) changed([history('undo')]);
  }, [stack, changed]);
  const redo = useCallback(() => {
    if (stack.redo()) changed([history('redo')]);
  }, [stack, changed]);

  const rename = useCallback(
    (next: string) => {
      setName(next);
      queue.push({ name: next });
    },
    [queue],
  );

  const project = stack.project;
  const issues: readonly ValidationIssue[] = useMemo(
    () =>
      validateProject(project, machine ? { machine } : { toolDiameter: FALLBACK_TOOL_DIAMETER }),
    [project, machine],
  );

  return {
    project,
    issues,
    name,
    saveState,
    revision,
    projectId: queue.projectId,
    restoredCount: boot.replayed.length,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    dirty: queue.dirty,
    run,
    recordApplied,
    undo,
    redo,
    rename,
    flush: () => queue.flush(),
    /** Saves and waits until the project is on the server; its id or `null` (T264). */
    settle: () => queue.settle(),
    /** Forget unsent changes (after a conflict was resolved by reloading or copying). */
    discard: () => queue.discard(),
  };
}

export type ProjectSession = ReturnType<typeof useProjectSession>;
