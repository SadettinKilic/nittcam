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
  dropParkedQueue,
  parkedQueue,
  queueKey,
  takeOverQueue,
  storedQueue,
  takeUnsentQueue,
  type KeyValueStorage,
  type StoredQueue,
  type RestoredUnit,
  type SaveRequest,
  type SaveState,
  type SendResult,
} from './autosave';
import { FALLBACK_TOOL_DIAMETER } from './draft-project';
import type { ProjectDetail, SaveResponse } from './projects-api';

/**
 * `localStorage`, or null where the browser blocks it. T326 (D-117): the unsent queue lives here so
 * a closed tab, a crash or a new tab finds it again (`sessionStorage` ends with the tab).
 */
function queueStore(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Where versions before T326 kept the queue; read once, then cleared. */
function legacyStore(): KeyValueStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * T326: a close-time save body up to this size goes with `keepalive`, so it is delivered after
 * the page is gone (the browser allows 64 KiB of keepalive bodies per page). A bigger project is
 * sent normally (it may be cut off with the page); its unsent queue stays stored for the next page.
 */
export const KEEPALIVE_MAX_BYTES = 60_000;

function byteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** The address parameter that names a new project's draft (T305, D-094). */
export const DRAFT_PARAM = 'taslak';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The draft id from the address, when it is a well-formed UUID. */
function validDraft(v: string | null | undefined): string | undefined {
  return v && UUID.test(v) ? v.toLowerCase() : undefined;
}

/** Sends one autosave request: POST for a new project, PUT with the revision lock otherwise. */
export async function sendSave(req: SaveRequest): Promise<SendResult> {
  const body = JSON.stringify(
    req.id === null
      ? {
          ...(req.newId ? { id: req.newId } : {}),
          name: req.name,
          project: req.project,
          commands: req.commands,
          saveId: req.saveId,
        }
      : {
          project: req.project,
          baseRevision: req.baseRevision,
          commands: req.commands,
          name: req.name,
          saveId: req.saveId,
        },
  );
  const url = req.id === null ? '/api/projects' : `/api/projects/${encodeURIComponent(req.id)}`;
  const init: RequestInit = {
    method: req.id === null ? 'POST' : 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  };
  let res: Response;
  try {
    // T326: a save sent while the page closes outlives the page when it is small enough.
    const keepalive = req.keepalive === true && byteLength(body) <= KEEPALIVE_MAX_BYTES;
    try {
      res = await fetch(url, { ...init, keepalive });
    } catch (err) {
      // A browser that refuses the keepalive (its quota is shared with other requests) sends it
      // normally; the same save id makes a repeat harmless.
      if (!keepalive) throw err;
      res = await fetch(url, init);
    }
  } catch {
    return { ok: false, kind: 'network' };
  }
  if (res.status === 409) return { ok: false, kind: 'conflict' };
  if (res.status >= 400 && res.status < 500) return { ok: false, kind: 'invalid' };
  if (!res.ok) return { ok: false, kind: 'server' };
  const saved = (await res.json()) as ProjectDetail | SaveResponse;
  return { ok: true, id: saved.id, revision: saved.revision };
}

export interface SessionInit {
  id: string | null;
  /** Server revision (0 for a project that is not created yet). */
  revision: number;
  /** Id of the save that produced that revision (T326: did the last close-time save arrive?). */
  lastSaveId?: string | null;
  name: string;
  project: Project;
}

const now = () => new Date().toISOString();

/** The Web Locks API where the browser has it (B60: a lock dies with its page, crash included). */
function webLocks(): LockManager | null {
  try {
    return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
  } catch {
    return null;
  }
}

/** Lock name of a stored queue (B60): held by the page that writes it, for as long as it lives. */
export function queueLockName(id: string | null, newId?: string): string {
  return 'nittcam-queue:' + queueKey(id, newId);
}

/**
 * Replays a stored queue onto `stack` (T326): a unit the earlier page had on the way is resent as
 * it was (the project after its own entries), then the rest is replayed on top.
 */
function replayStored(
  stack: CommandStack,
  stored: StoredQueue,
): { replayed: CommandLogEntry[]; unit: RestoredUnit | undefined } {
  const count = stored.unit?.count ?? 0;
  const first = replayLog(stack, stored.entries.slice(0, count));
  const unit =
    stored.unit && first > 0
      ? { saveId: stored.unit.saveId, count: first, project: stack.project }
      : undefined;
  const rest = first === count ? replayLog(stack, stored.entries.slice(count)) : 0;
  return { replayed: stored.entries.slice(0, first + rest), unit };
}
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
  draft,
}: {
  initial: SessionInit;
  machine: MachineProfile | null;
  onCreated: (id: string) => void;
  /** `?taslak=` of the address (T305); only read for a project not created yet. */
  draft?: string | null;
}) {
  // A reload before the last save went through: replay the unsent commands of this tab (§8.2).
  const [boot] = useState(() => {
    const stack = new CommandStack(initial.project);
    // T305 (D-094): a new project's queue is keyed by its draft id, which the address carries
    // (`?taslak=`) until the first save; only that draft's own queue is replayed. Another
    // "Yeni proje" (no draft in the address, or one this tab has no queue for) starts empty.
    const draftId = initial.id === null ? validDraft(draft) : undefined;
    const server = { revision: initial.revision, lastSaveId: initial.lastSaveId ?? null };
    // B60: with Web Locks the shared queue is taken only once this page holds its lock (below);
    // without them, here by the age rule (T326).
    const locked = webLocks() !== null;
    const stored =
      (locked ? null : takeUnsentQueue(queueStore(), initial.id, server, draftId)) ??
      takeUnsentQueue(legacyStore(), initial.id, server, draftId);
    const draftLeft =
      locked &&
      draftId !== undefined &&
      storedQueue(queueStore(), queueKey(null, draftId)) !== null;
    const { replayed, unit } = stored
      ? replayStored(stack, stored)
      : { replayed: [] as CommandLogEntry[], unit: undefined };
    // A new project gets its id here (D-030); after a reload during the first save the stored
    // queue keeps it, so the repeated create returns the same project instead of a duplicate.
    const newId =
      initial.id === null
        ? (stored?.newId ?? (draftLeft ? draftId : undefined) ?? crypto.randomUUID())
        : undefined;
    return { stack, replayed, unit, name: stored?.name ?? initial.name, newId };
  });
  const stack = boot.stack;
  const [, setVersion] = useState(0);
  const [name, setName] = useState(boot.name);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [revision, setRevision] = useState(initial.revision);
  const [restoredCount, setRestoredCount] = useState(boot.replayed.length);
  // B60: until this page knows (by its Web Lock) whether the page that left a queue is gone, edits
  // wait: a left queue is replayed before the first local edit. Only where the browser has locks.
  const recovering = useRef(webLocks() !== null);
  const [, setRecovered] = useState(false);
  // B60: changes left by an earlier page that no longer fit the server: the user applies or
  // deletes them (never dropped silently).
  const [parked, setParked] = useState<StoredQueue | null>(() =>
    initial.id ? parkedQueue(queueStore(), initial.id) : null,
  );

  const [queue] = useState(() => {
    const q = new AutosaveQueue(
      {
        send: async (req) => {
          const r = await sendSave(req);
          if (r.ok) setRevision(r.revision);
          return r;
        },
        storage: queueStore(),
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
    );
    if (webLocks()) q.useLocks();
    return q;
  });

  useEffect(() => {
    queue.setOnCreated(onCreated);
  }, [queue, onCreated]);

  // Hand the replayed commands (or a renamed draft) to the queue once, after mount.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // Versions before T326 kept the queue per tab; it is in the queue now (or was stale).
    try {
      legacyStore()?.removeItem(queueKey(initial.id, boot.newId));
    } catch {
      // Storage is a convenience.
    }
    if (boot.replayed.length > 0 || boot.name !== initial.name) {
      queue.restore({
        entries: boot.replayed,
        project: stack.project,
        name: boot.name,
        ...(boot.unit ? { unit: boot.unit } : {}),
      });
    }
  }, [boot, initial.id, initial.name, queue, stack]);

  // B60 fix round 1 (PO): liveness by Web Locks, not by age. This page holds the lock of its queue
  // for as long as it lives; the browser frees it when the page dies (crash included). Granted at
  // once: whoever wrote a stored queue is gone, so it is taken over and replayed now. Held by a
  // live tab: that tab keeps it (two-tab rule unchanged) and this page waits for the lock.
  useEffect(() => {
    const locks = webLocks();
    if (!locks) return;
    const store = queueStore();
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const abort = new AbortController();
    let gone = false;
    const done = () => {
      recovering.current = false;
      setRecovered(true);
    };
    const grant = (): Promise<void> => {
      if (gone) return Promise.resolve();
      const clean =
        !queue.dirty && queue.projectId === initial.id && queue.baseRevision === initial.revision;
      const stored = takeOverQueue(store, {
        id: queue.projectId,
        ...(boot.newId ? { newId: boot.newId } : {}),
        server: { revision: initial.revision, lastSaveId: initial.lastSaveId ?? null },
        clean,
        pageId: queue.ownerId,
      });
      if (stored) {
        const { replayed, unit } = replayStored(stack, stored);
        setRestoredCount((n) => n + replayed.length);
        if (replayed.length > 0 || stored.name !== initial.name) {
          if (stored.name !== initial.name) setName(stored.name);
          queue.restore({
            entries: replayed,
            project: stack.project,
            name: stored.name,
            ...(unit ? { unit } : {}),
          });
        }
      }
      const id = queue.projectId;
      if (id) setParked(parkedQueue(store, id));
      queue.claim();
      done();
      return held;
    };
    const name = queueLockName(initial.id, boot.newId);
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (lock) return grant();
        done();
        void locks.request(name, { signal: abort.signal }, () => grant()).catch(() => undefined);
        return undefined;
      })
      .catch(() => done());
    return () => {
      gone = true;
      abort.abort();
      release();
    };
    // Once per page: the lock follows the queue the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // T187: the connection is back, send the unsent queue now instead of waiting for the backoff.
  useEffect(() => {
    const onOnline = () => void queue.flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [queue]);

  // Leaving the wizard (or the tab going to the background) saves what is pending right away.
  // T326 (D-117): closing the tab or the browser (`pagehide`) sends what is pending with
  // `keepalive` and marks the stored queue as left, so the next page takes it at once; while
  // anything is unsaved the browser asks before the page is closed or reloaded.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void queue.flush();
    };
    const onPageHide = () => queue.closing();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) queue.reopened();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!queue.dirty) return;
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('beforeunload', onBeforeUnload);
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
      // B60: a left queue is replayed first (a few ms after the page opened).
      if (recovering.current) return false;
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
    if (recovering.current) return;
    if (stack.undo()) changed([history('undo')]);
  }, [stack, changed]);
  const redo = useCallback(() => {
    if (recovering.current) return;
    if (stack.redo()) changed([history('redo')]);
  }, [stack, changed]);

  const rename = useCallback(
    (next: string) => {
      setName(next);
      queue.push({ name: next });
    },
    [queue],
  );

  // T307: machine-dependent command checks (spindle range) read the selected machine.
  useEffect(() => {
    stack.setValidationContext(machine ? { machine } : {});
  }, [stack, machine]);

  /** B60: applies parked changes on top of the project as new edits (the user decided). */
  const applyParked = useCallback(() => {
    const id = queue.projectId;
    if (!parked || !id) return 0;
    const n = replayLog(stack, parked.entries);
    dropParkedQueue(queueStore(), id);
    setParked(null);
    if (n > 0) changed(parked.entries.slice(0, n));
    return n;
  }, [parked, queue, stack, changed]);
  const dropParked = useCallback(() => {
    const id = queue.projectId;
    if (id) dropParkedQueue(queueStore(), id);
    setParked(null);
  }, [queue]);

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
    /** The draft id of a project not created yet (T305: `?taslak=` in the address). */
    draftId: boot.newId,
    restoredCount,
    /** B60: changes an earlier page left that no longer fit the server (count), or 0. */
    parkedCount: parked?.entries.length ?? 0,
    applyParked,
    dropParked,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    redoCommand: stack.redoCommand,
    dirty: queue.dirty,
    /** Commands not on the server yet (T187 banner). */
    unsentCount: queue.pending.length,
    run,
    recordApplied,
    undo,
    redo,
    rename,
    flush: () => queue.flush(),
    /** "Tekrar dene" (T187): send now, skipping the retry backoff. */
    retry: () => queue.flush(),
    /** Saves and waits until the project is on the server; its id or `null` (T264). */
    settle: () => queue.settle(),
    /** Forget unsent changes (after a conflict was resolved by reloading or copying). */
    discard: () => queue.discard(),
  };
}

export type ProjectSession = ReturnType<typeof useProjectSession>;
