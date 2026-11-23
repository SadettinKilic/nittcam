/**
 * Autosave with the revision lock and a local unsent-command queue (spec §8.2, T023, D-029).
 *
 * The server is the single source of the project. The client keeps only the commands it has not
 * sent yet: in memory and mirrored to `localStorage` (T326, D-117: it survives a closed tab, a
 * browser crash and is found again from a new tab), with the revision they are based on. A save
 * sends the whole project, its base revision and those commands; the server stores the project,
 * increments the revision and appends the commands. Saves are debounced (1 s after the last
 * change), one at a time; a network or server error is retried with backoff; a stale revision
 * (409) stops autosave until the user resolves the conflict.
 *
 * T326 (D-117): every save is a *unit* with a client `saveId`. Once sent, a unit is never changed:
 * a retry (or the next page after a close) resends exactly that unit with the same id, and the
 * server answers a repeat from its stored row instead of applying it twice. The stored queue names
 * the unit on the way, so a reopened page knows whether it went through (the server's
 * `lastSaveId`) and replays only what came after it.
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
  /** Client id of this save unit (T326): the same id is resent until the server answered it. */
  saveId: string;
  /** Sent while the page closes (T326): the transport lets it outlive the page. */
  keepalive?: boolean;
}

/** What the server has now: its revision and the id of the save that produced it (T326). */
export interface ServerState {
  revision: number;
  lastSaveId?: string | null;
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
  /** Id of this page (T326): marks the stored queue as this page's while the page lives. */
  pageId?: string;
  /** Wall clock, ms (T326: the stored queue's age tells a live page from a crashed one). */
  now?(): number;
  /** A fresh save id (default `crypto.randomUUID()`). */
  newSaveId?(): string;
}

/** What the unsent queue keeps per project in `sessionStorage`. */
export interface StoredQueue {
  baseRevision: number;
  entries: CommandLogEntry[];
  name: string;
  /** The client-generated id of a project not created yet (D-030). */
  newId?: string;
  /** T326: the first `count` entries were sent as save `saveId` on `baseRevision`; no answer yet. */
  unit?: { saveId: string; count: number };
  /** T326: the page that writes this queue, when it last wrote it, and whether it was closed. */
  owner?: string;
  at?: number;
  closed?: boolean;
}

/** A unit that a reopened page resends as it was (the project after its `count` entries). */
export interface RestoredUnit {
  saveId: string;
  count: number;
  project: Project;
}

export const DEBOUNCE_MS = 1000;
/**
 * T326: a stored queue that its page has not written for this long, and that was not closed, is
 * taken to belong to a crashed page. A live page rewrites it on every change and every attempt.
 */
export const STALE_MS = 15_000;
const KEY_PREFIX = 'nittcam.unsent.';
/**
 * Queue key of a project that is not created on the server yet: `new.<draft id>`. T305 (D-094):
 * the key names that one draft, so another new project never picks up its commands. The bare
 * `new` key of earlier versions was shared by every draft and is only ever removed.
 */
export const NEW_PROJECT_KEY = 'new';

export function queueKey(id: string | null, newId?: string): string {
  if (id !== null) return KEY_PREFIX + id;
  return KEY_PREFIX + NEW_PROJECT_KEY + (newId ? `.${newId}` : '');
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
    const unit = q.unit;
    const validUnit =
      unit &&
      typeof unit.saveId === 'string' &&
      Number.isInteger(unit.count) &&
      unit.count > 0 &&
      unit.count <= q.entries.length;
    return {
      baseRevision: q.baseRevision,
      entries: q.entries,
      name: q.name,
      ...(typeof q.newId === 'string' ? { newId: q.newId } : {}),
      ...(validUnit ? { unit: { saveId: unit.saveId, count: unit.count } } : {}),
      ...(typeof q.owner === 'string' ? { owner: q.owner } : {}),
      ...(typeof q.at === 'number' ? { at: q.at } : {}),
      ...(q.closed === true ? { closed: true } : {}),
    };
  } catch {
    return null;
  }
}

function forget(storage: KeyValueStorage | null | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage is a convenience.
  }
}

/** T326: a queue that another page still writes (open in another tab) is left to that page. */
export function heldByLivePage(q: StoredQueue, now: number): boolean {
  return q.owner !== undefined && q.closed !== true && q.at !== undefined && now - q.at < STALE_MS;
}

/**
 * What of a stored queue is still to be saved, given what the server has now (T326, D-117):
 * - the server is still on the queue's base revision: all of it (its unit is resent as it was);
 * - the server is one revision ahead, made by the queue's own unit: only the entries after it;
 * - anything else (saved after all, or someone else saved): nothing, the queue is stale.
 */
export function remainingQueue(q: StoredQueue, server: ServerState): StoredQueue | null {
  if (q.baseRevision === server.revision) return q;
  if (q.unit && server.lastSaveId === q.unit.saveId && server.revision === q.baseRevision + 1) {
    const { unit, newId: _newId, ...rest } = q;
    void _newId;
    return { ...rest, baseRevision: server.revision, entries: q.entries.slice(unit.count) };
  }
  return null;
}

/**
 * The unsent queue left by an earlier page (a reload, a closed tab, a crash: T326) that was not
 * saved yet. It is only usable when it is based on what the server has now (`remainingQueue`):
 * otherwise the commands were saved after all (or someone else saved), and the queue is dropped.
 * A queue another open page still writes is left alone. For a saved project the queue of the draft
 * it was created from is looked at too (the page closed while its create was on the way).
 */
export function takeUnsentQueue(
  storage: KeyValueStorage | null | undefined,
  id: string | null,
  server: number | ServerState,
  /** For a new project: its draft id (T305: only this draft's own queue is ever replayed). */
  newId?: string,
  now: number = Date.now(),
): StoredQueue | null {
  const state: ServerState = typeof server === 'number' ? { revision: server } : server;
  if (id === null) {
    // The shared key of earlier versions cannot say which draft it belongs to: drop it.
    forget(storage, queueKey(null));
    if (!newId) return null;
  }
  const keys = id === null ? [queueKey(null, newId)] : [queueKey(id), queueKey(null, id)];
  for (const key of keys) {
    const q = readQueue(storage, key);
    if (!q) {
      // Nothing stored, or a value that is not a queue (T020): never leave a corrupt one behind.
      forget(storage, key);
      continue;
    }
    if (heldByLivePage(q, now)) continue;
    const draftKey = key !== queueKey(id, newId);
    const left =
      (id === null || draftKey) && q.newId !== (id ?? newId) ? null : remainingQueue(q, state);
    if (!left) {
      forget(storage, key);
      continue;
    }
    if (left !== q && left.entries.length === 0) {
      // Everything went through; only a name might still differ (the page compares it).
      forget(storage, key);
    }
    return left;
  }
  return null;
}

/** A save unit: fixed once formed, resent as it is until the server answers it (T326). */
interface Unit {
  saveId: string;
  count: number;
  project: Project;
  name: string;
  /** The change generation the unit covers. */
  generation: number;
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
  /** The unit on the way or waiting for a retry (T326). */
  private unit: Unit | null = null;
  private timer: unknown = null;
  private inFlight = false;
  /** Resolves when the request in flight has come back (T264: `settle` waits for it). */
  private running: Promise<void> | null = null;
  private again = false;
  private attempt = 0;
  private current: SaveState = 'idle';
  private disposed = false;
  /** T326: the page is being closed (the stored queue says so, another page may take it). */
  private closed = false;
  private readonly pageId: string;
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
    this.pageId = deps.pageId ?? newUuid();
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

  /**
   * Takes over the queue an earlier page left (T326): its entries, and the unit that page had on
   * the way, which is resent first exactly as it was (same save id, the project after its entries).
   */
  restore(change: {
    entries: readonly CommandLogEntry[];
    project: Project;
    name: string;
    unit?: RestoredUnit;
  }): void {
    if (this.disposed) return;
    const u = change.unit;
    if (u && u.count > 0 && u.count <= change.entries.length) {
      this.unit = {
        saveId: u.saveId,
        count: u.count,
        project: u.project,
        name: change.name,
        // A unit that covers every entry completes the restored change; otherwise more follows.
        generation: u.count === change.entries.length ? this.generation + 1 : this.generation,
      };
    }
    this.push(change);
    // A draft whose create went through left its queue under the draft key: it is now ours.
    if (this.id !== null) this.removeStored(queueKey(null, this.id));
  }

  /** Saves now (skips the debounce), e.g. before leaving a step. */
  flush(): Promise<void> {
    this.cancelTimer();
    return this.save();
  }

  /**
   * The page is going away (`pagehide`, T326): marks the stored queue as closed, so the next page
   * (this tab reloaded, or a new tab) takes it at once, and sends what it can with `keepalive`
   * (it outlives the page): what is pending when nothing is on the way, else the unit on the way
   * once more (the one in flight may be cut off with the page; the same save id is applied once).
   * Changes after a unit on the way wait in the stored queue for the next page.
   */
  closing(): void {
    if (this.disposed) return;
    this.closed = true;
    if (!this.dirty) return;
    this.persist();
    if (this.current === 'conflict') return;
    if (!this.inFlight) {
      this.cancelTimer();
      void this.save(true);
      return;
    }
    const unit = this.unit;
    if (unit) {
      void Promise.resolve()
        .then(() => this.deps.send({ ...this.request(unit), keepalive: true }))
        .catch(() => undefined);
    }
  }

  /** The page came back from the back/forward cache: it owns its queue again. */
  reopened(): void {
    if (this.disposed || !this.closed) return;
    this.closed = false;
    this.persist();
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
    this.unit = null;
    this.savedGeneration = this.generation;
    this.removeStored(queueKey(this.id, this.newId));
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

  private request(unit: Unit): SaveRequest {
    return {
      id: this.id,
      ...(this.id === null && this.newId ? { newId: this.newId } : {}),
      baseRevision: this.revision,
      project: unit.project,
      commands: this.entries.slice(0, unit.count),
      name: unit.name,
      saveId: unit.saveId,
    };
  }

  private async save(keepalive = false): Promise<void> {
    if (this.disposed || this.current === 'conflict' || !this.dirty) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    let finished = () => {};
    this.running = new Promise<void>((resolve) => (finished = resolve));
    // T326: a unit not answered yet is resent unchanged; otherwise everything pending forms one.
    const unit: Unit = (this.unit ??= {
      saveId: (this.deps.newSaveId ?? newUuid)(),
      count: this.entries.length,
      project: this.project,
      name: this.name,
      generation: this.generation,
    });
    // The stored queue names the unit before it leaves: a page closed now knows what was sent.
    this.persist();
    const wasNew = this.id === null;
    this.setState('saving');
    let result: SendResult;
    try {
      const req = this.request(unit);
      result = await this.deps.send(keepalive ? { ...req, keepalive: true } : req);
    } catch {
      result = { ok: false, kind: 'network' };
    }
    this.inFlight = false;
    this.running = null;
    finished();
    if (this.disposed) return;

    if (result.ok) {
      const oldKey = queueKey(this.id, this.newId);
      this.id = result.id;
      this.revision = result.revision;
      this.entries.splice(0, unit.count);
      this.unit = null;
      this.savedGeneration = unit.generation;
      this.attempt = 0;
      if (wasNew) {
        this.removeStored(oldKey);
        this.createdListener?.(result.id);
      }
      this.persist();
      if (this.dirty) {
        this.setState('pending');
        // A closing page sends the rest at once: it has no debounce left to wait for.
        if (this.again || this.closed) {
          this.again = false;
          void this.save(this.closed);
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
    // A request the server refused as invalid is not resent as it was; the next change forms a
    // new unit. Network and server errors resend the same unit (the server may have stored it).
    if (result.kind === 'invalid') this.unit = null;
    this.persist(); // keeps the stored queue fresh while the page retries (T326)
    this.setState('error');
    if (result.kind === 'invalid') return; // the same request would fail again; next change retries
    this.attempt += 1;
    this.schedule((this.deps.retryMs ?? defaultRetryMs)(this.attempt));
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** T326: whether this page may write the stored queue (not another live page's). */
  private mayWrite(key: string): boolean {
    const q = readQueue(this.deps.storage, key);
    return !q || q.owner === this.pageId || !heldByLivePage(q, this.now());
  }

  private persist(): void {
    const key = queueKey(this.id, this.newId);
    if (!this.dirty) {
      this.removeStored(key);
      return;
    }
    if (!this.mayWrite(key)) return;
    const q: StoredQueue = {
      baseRevision: this.revision,
      entries: this.entries,
      name: this.name,
      ...(this.id === null && this.newId ? { newId: this.newId } : {}),
      ...(this.unit ? { unit: { saveId: this.unit.saveId, count: this.unit.count } } : {}),
      owner: this.pageId,
      at: this.now(),
      ...(this.closed ? { closed: true } : {}),
    };
    try {
      this.deps.storage?.setItem(key, JSON.stringify(q));
    } catch {
      // Quota or blocked storage: the in-memory queue still saves.
    }
  }

  private removeStored(key: string): void {
    if (!this.mayWrite(key)) return;
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

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** A new project left before it was created on the server (T326: offered again on Projeler). */
export interface LeftDraft {
  draftId: string;
  name: string;
  changes: number;
}

const DRAFT_KEY = /^nittcam\.unsent\.new\.([0-9a-f-]{36})$/;

/**
 * The drafts whose page is gone (closed, crashed) with changes the server never confirmed, from
 * the stored keys (T326, D-117). A draft another open page still writes is not listed.
 */
export function leftDrafts(
  storage: KeyValueStorage | null | undefined,
  keys: readonly string[],
  now: number = Date.now(),
): LeftDraft[] {
  const out: LeftDraft[] = [];
  for (const key of keys) {
    const m = DRAFT_KEY.exec(key);
    if (!m?.[1]) continue;
    const q = readQueue(storage, key);
    if (!q || q.newId !== m[1] || q.entries.length === 0 || heldByLivePage(q, now)) continue;
    out.push({ draftId: m[1], name: q.name, changes: q.entries.length });
  }
  return out.sort((a, b) => a.draftId.localeCompare(b.draftId));
}

/**
 * Drops a left draft's stored queue after the user confirmed "Taslağı sil" (T326 rider). Only that
 * draft's key goes; blocked storage is ignored (nothing is stored there either).
 */
export function discardLeftDraft(
  storage: KeyValueStorage | null | undefined,
  draftId: string,
): void {
  try {
    storage?.removeItem(queueKey(null, draftId));
  } catch {
    // Blocked storage: nothing stored either.
  }
}
