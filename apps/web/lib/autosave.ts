/**
 * Autosave with the revision lock and a local unsent-command queue (spec §8.2, T023, D-029).
 *
 * The server is the single source of the project. The client keeps only the commands it has not
 * sent yet: in memory and mirrored to `sessionStorage` (per tab), with the revision they are based
 * on. A save sends the whole project, its base revision and those commands; the server stores the
 * project, increments the revision and appends the commands. Saves are debounced (1 s after the
 * last change), one at a time; a network or server error is retried with backoff; a stale
 * revision (409) stops autosave until the user resolves the conflict.
 *
 * Framework-free: the timer, the storage and the transport are injected, so the logic is unit
 * tested without a browser.
 */
import type { CommandLogEntry, Project } from '@nittcam/core';

export type SaveState =
  /** Nothing to save since the project was loaded. */
  | 'idle'
  /** Changes wait for the debounce. */
  | 'pending'
  | 'saving'
  | 'saved'
  /** The last save failed; it is retried. */
  | 'error'
  /** The server has a newer revision; autosave stopped (spec §8.2). */
  | 'conflict';

export interface SaveRequest {
  /** Null for a project that does not exist on the server yet (created by this save). */
  id: string | null;
  /**
   * Client-generated id of a project that is not created yet (D-030): the create is idempotent on
   * it, so a repeated create (reload during the first save, retry) returns the same project.
   */
  newId?: string;
  baseRevision: number;
  project: Project;
  commands: CommandLogEntry[];
  name: string;
}

export type SendResult =
  | { ok: true; id: string; revision: number }
  | { ok: false; kind: 'conflict' | 'network' | 'server' | 'invalid' };

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveDeps {
  send(request: SaveRequest): Promise<SendResult>;
  storage?: KeyValueStorage | null;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onState?(state: SaveState): void;
  /** The first save created the project on the server. */
  onCreated?(id: string): void;
  /** Debounce after the last change, ms (default 1000). */
  debounceMs?: number;
  /** Retry delay after the n-th failed attempt (1-based), ms. */
  retryMs?(attempt: number): number;
}

/** What the unsent queue keeps per project in `sessionStorage`. */
export interface StoredQueue {
  baseRevision: number;
  entries: CommandLogEntry[];
  name: string;
  /** The client-generated id of a project not created yet (D-030). */
  newId?: string;
}

export const DEBOUNCE_MS = 1000;
const KEY_PREFIX = 'nittcam.unsent.';
/** Queue key of a project that is not created on the server yet. */
export const NEW_PROJECT_KEY = 'new';

export function queueKey(id: string | null): string {
  return KEY_PREFIX + (id ?? NEW_PROJECT_KEY);
}

/** 1 s, 2 s, 4 s, … up to 30 s. */
export function defaultRetryMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

function readQueue(storage: KeyValueStorage | null | undefined, key: string): StoredQueue | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const q = JSON.parse(raw) as Partial<StoredQueue>;
    if (
      typeof q.baseRevision !== 'number' ||
      !Array.isArray(q.entries) ||
      typeof q.name !== 'string'
    ) {
      return null;
    }
    return {
      baseRevision: q.baseRevision,
      entries: q.entries,
      name: q.name,
      ...(typeof q.newId === 'string' ? { newId: q.newId } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The unsent queue left by an earlier page of this tab (a reload before the save went through).
 * It is only usable when it is based on the revision the server has now: otherwise the commands
 * were saved after all (or someone else saved), and the queue is dropped.
 */
export function takeUnsentQueue(
  storage: KeyValueStorage | null | undefined,
  id: string | null,
  serverRevision: number,
): StoredQueue | null {
  const key = queueKey(id);
  const q = readQueue(storage, key);
  if (!q) return null;
  if (q.baseRevision !== serverRevision) {
    try {
      storage?.removeItem(key);
    } catch {
      // Storage is a convenience.
    }
    return null;
  }
  return q;
}

export class AutosaveQueue {
  private id: string | null;
  private readonly newId: string | undefined;
  private revision: number;
  private name: string;
  private project: Project;
  private entries: CommandLogEntry[] = [];
  /** Bumped on every change; a save is complete when nothing changed while it ran. */
  private generation = 0;
  private savedGeneration = 0;
  private timer: unknown = null;
  private inFlight = false;
  /** Resolves when the request in flight has come back (T264: `settle` waits for it). */
  private running: Promise<void> | null = null;
  private again = false;
  private attempt = 0;
  private current: SaveState = 'idle';
  private disposed = false;
  private readonly deps: AutosaveDeps;
  private createdListener: ((id: string) => void) | undefined;

  constructor(
    deps: AutosaveDeps,
    init: {
      id: string | null;
      revision: number;
      name: string;
      project: Project;
      /** Client-generated id for the create of a new project (D-030). */
      newId?: string;
    },
  ) {
    this.deps = deps;
    this.createdListener = deps.onCreated;
    this.id = init.id;
    this.newId = init.newId;
    this.revision = init.revision;
    this.name = init.name;
    this.project = init.project;
  }

  get state(): SaveState {
    return this.current;
  }
  get projectId(): string | null {
    return this.id;
  }
  get baseRevision(): number {
    return this.revision;
  }
  /** Commands not yet confirmed by the server. */
  get pending(): readonly CommandLogEntry[] {
    return this.entries;
  }
  get dirty(): boolean {
    return this.generation !== this.savedGeneration;
  }

  /** Records changes (new log entries and/or the resulting project, a new name). */
  push(change: { entries?: readonly CommandLogEntry[]; project?: Project; name?: string }): void {
    if (this.disposed) return;
    if (change.entries) this.entries.push(...change.entries);
    if (change.project) this.project = change.project;
    if (change.name !== undefined) this.name = change.name;
    this.generation += 1;
    this.persist();
    if (this.current === 'conflict') return;
    this.setState('pending');
    this.schedule(this.deps.debounceMs ?? DEBOUNCE_MS);
  }

  /** Saves now (skips the debounce), e.g. before leaving a step. */
  flush(): Promise<void> {
    this.cancelTimer();
    return this.save();
  }

  /**
   * Saves everything pending and waits until it is on the server, including a save already in
   * flight (T264: leaving for the machine form must know the project's id). Resolves with the
   * project id, or `null` when a new project could not be created (the unsent queue stays stored,
   * so `/projeler/yeni` restores it). Never retries a failed save itself.
   */
  async settle(): Promise<string | null> {
    for (let round = 0; round < 10; round += 1) {
      this.cancelTimer();
      if (this.running) {
        await this.running;
        continue;
      }
      if (this.disposed || this.current === 'conflict' || !this.dirty) break;
      const before = this.attempt;
      await this.save();
      if (this.attempt > before) break; // failed; the regular retry timer takes over
    }
    return this.id;
  }

  /** After the user resolved a conflict elsewhere (reload / copy): stop and forget the queue. */
  discard(): void {
    this.cancelTimer();
    this.entries = [];
    this.savedGeneration = this.generation;
    this.removeStored(queueKey(this.id));
    this.setState('idle');
  }

  /** Replaces the callback for the first save that created the project (UI wiring). */
  setOnCreated(fn: ((id: string) => void) | undefined): void {
    this.createdListener = fn;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.save();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private async save(): Promise<void> {
    if (this.disposed || this.current === 'conflict' || !this.dirty) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    let finished = () => {};
    this.running = new Promise<void>((resolve) => (finished = resolve));
    const sentCount = this.entries.length;
    const sentGeneration = this.generation;
    const wasNew = this.id === null;
    this.setState('saving');
    let result: SendResult;
    try {
      result = await this.deps.send({
        id: this.id,
        ...(this.id === null && this.newId ? { newId: this.newId } : {}),
        baseRevision: this.revision,
        project: this.project,
        commands: this.entries.slice(0, sentCount),
        name: this.name,
      });
    } catch {
      result = { ok: false, kind: 'network' };
    }
    this.inFlight = false;
    this.running = null;
    finished();
    if (this.disposed) return;

    if (result.ok) {
      const oldKey = queueKey(this.id);
      this.id = result.id;
      this.revision = result.revision;
      this.entries.splice(0, sentCount);
      this.savedGeneration = sentGeneration;
      this.attempt = 0;
      if (wasNew) {
        this.removeStored(oldKey);
        this.createdListener?.(result.id);
      }
      this.persist();
      if (this.dirty) {
        this.setState('pending');
        if (this.again) {
          this.again = false;
          void this.save();
        } else {
          this.schedule(this.deps.debounceMs ?? DEBOUNCE_MS);
        }
      } else {
        this.again = false;
        this.setState('saved');
      }
      return;
    }

    this.again = false;
    if (result.kind === 'conflict') {
      this.cancelTimer();
      this.setState('conflict');
      return;
    }
    this.setState('error');
    if (result.kind === 'invalid') return; // the same request would fail again; next change retries
    this.attempt += 1;
    this.schedule((this.deps.retryMs ?? defaultRetryMs)(this.attempt));
  }

  private persist(): void {
    const key = queueKey(this.id);
    if (!this.dirty) {
      this.removeStored(key);
      return;
    }
    const q: StoredQueue = {
      baseRevision: this.revision,
      entries: this.entries,
      name: this.name,
      ...(this.id === null && this.newId ? { newId: this.newId } : {}),
    };
    try {
      this.deps.storage?.setItem(key, JSON.stringify(q));
    } catch {
      // Quota or blocked storage: the in-memory queue still saves.
    }
  }

  private removeStored(key: string): void {
    try {
      this.deps.storage?.removeItem(key);
    } catch {
      // Storage is a convenience.
    }
  }

  private setState(state: SaveState): void {
    if (state === this.current) return;
    this.current = state;
    this.deps.onState?.(state);
  }
}
