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
  /**
   * B60 fix round 3, parked changes only: a page is applying them ("Uygula") with the save
   * `saveId`; they stay parked until that save lands.
   */
  applying?: { owner: string; saveId?: string };
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
      ...(q.applying && typeof q.applying.owner === 'string'
        ? {
            applying: {
              owner: q.applying.owner,
              ...(typeof q.applying.saveId === 'string' ? { saveId: q.applying.saveId } : {}),
            },
          }
        : {}),
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
 * B60 fix round 1: a stored queue that cannot be replayed cleanly (the server moved on, e.g. by a
 * newer save from this browser) is never dropped silently. It is parked under
 * `nittcam.unsent.left.<project id>` and offered to the user (apply / delete).
 */
const LEFT_PREFIX = KEY_PREFIX + 'left.';

export function leftKey(projectId: string): string {
  return LEFT_PREFIX + projectId;
}

/** Parks `q` for `projectId` (appended to what is parked there already). */
export function parkQueue(
  storage: KeyValueStorage | null | undefined,
  projectId: string,
  q: StoredQueue,
): void {
  if (q.entries.length === 0) return;
  const before = readQueue(storage, leftKey(projectId));
  // B60 r3: parked changes that were being applied are in the applying page's queue again (it
  // put them first): that queue replaces them, never twice.
  const keep = before !== null && !(before.applying && before.applying.owner === q.owner);
  const parked: StoredQueue = {
    baseRevision: q.baseRevision,
    entries: [...(keep && before ? before.entries : []), ...q.entries],
    name: q.name,
    closed: true,
  };
  try {
    storage?.setItem(leftKey(projectId), JSON.stringify(parked));
  } catch {
    // Storage is a convenience.
  }
}

/** The parked changes of `projectId`, or null. */
export function parkedQueue(
  storage: KeyValueStorage | null | undefined,
  projectId: string,
): StoredQueue | null {
  const q = readQueue(storage, leftKey(projectId));
  return q && q.entries.length > 0 ? q : null;
}

/** B60 r3: marks the parked changes of `projectId` as being applied by `owner` (or clears it). */
export function markParkedApplying(
  storage: KeyValueStorage | null | undefined,
  projectId: string,
  applying: { owner: string; saveId?: string } | null,
): void {
  const q = readQueue(storage, leftKey(projectId));
  if (!q) return;
  const { applying: _old, ...rest } = q;
  void _old;
  try {
    storage?.setItem(leftKey(projectId), JSON.stringify(applying ? { ...rest, applying } : rest));
  } catch {
    // Storage is a convenience.
  }
}

export function dropParkedQueue(
  storage: KeyValueStorage | null | undefined,
  projectId: string,
): void {
  forget(storage, leftKey(projectId));
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
  opts: {
    /**
     * B60: this page holds the queue's Web Lock, so any other writer is gone (crash included):
     * the queue is taken whatever its age. Without locks the age rule (`heldByLivePage`) decides.
     */
    owned?: boolean;
    /** This page's own id: its own queue is never "taken". */
    pageId?: string;
    /**
     * B60 fix round 2: whether the queue of the draft a saved project came from may be looked at.
     * With locks only when this page also holds the draft's lock (its page is gone); a live page
     * that created the project still owns that queue until it moves it.
     */
    draft?: boolean;
  } = {},
): StoredQueue | null {
  const state: ServerState = typeof server === 'number' ? { revision: server } : server;
  if (id === null) {
    // The shared key of earlier versions cannot say which draft it belongs to: drop it.
    forget(storage, queueKey(null));
    if (!newId) return null;
  }
  const keys =
    id === null
      ? [queueKey(null, newId)]
      : opts.draft === false
        ? [queueKey(id)]
        : [queueKey(id), queueKey(null, id)];
  for (const key of keys) {
    const q = readQueue(storage, key);
    if (!q) {
      // Nothing stored, or a value that is not a queue (T020): never leave a corrupt one behind.
      forget(storage, key);
      continue;
    }
    if (opts.pageId !== undefined && q.owner === opts.pageId) continue;
    if (!opts.owned && heldByLivePage(q, now)) continue;
    const draftKey = key !== queueKey(id, newId);
    const foreign = (id === null || draftKey) && q.newId !== (id ?? newId);
    const left = foreign ? null : remainingQueue(q, state);
    if (!left) {
      // B60: changes of this project that no longer fit the server are parked, never dropped.
      if (!foreign && id !== null) parkQueue(storage, id, q);
      forget(storage, key);
      continue;
    }
    if ((left !== q && left.entries.length === 0) || (opts.owned && draftKey)) {
      // Everything went through; only a name might still differ (the page compares it). B60 r2: a
      // draft's queue taken under its lock is this page's now (it stores it under its own key).
      forget(storage, key);
    }
    return left;
  }
  return null;
}

/**
 * B60 F1: a page that does not hold its project's queue lock (another live tab does) stores its
 * own unsent queue under a key of its own, `nittcam.unsent.peer.<project id>.<page id>`, never
 * under the holder's key. The page holds the Web Lock `nittcam-page:<page id>` while it lives;
 * the lock holder takes the queue of a peer whose page lock is free (the peer is gone) and parks
 * it for the user (`takePeerQueue`).
 */
const PEER_PREFIX = KEY_PREFIX + 'peer.';

export function peerKey(projectId: string, pageId: string): string {
  return `${PEER_PREFIX}${projectId}.${pageId}`;
}

/** The Web Lock a page holds for as long as it lives (B60 F1). */
export function pageLockName(pageId: string): string {
  return 'nittcam-page:' + pageId;
}

/** Peer queues of `projectId` among the stored `keys`, with their page ids (not `ownPage`). */
export function peerQueueKeys(
  keys: readonly string[],
  projectId: string,
  ownPage: string,
): { key: string; pageId: string }[] {
  const prefix = `${PEER_PREFIX}${projectId}.`;
  const out: { key: string; pageId: string }[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const pageId = key.slice(prefix.length);
    if (pageId && pageId !== ownPage) out.push({ key, pageId });
  }
  return out;
}

/**
 * B60 F1: the peer page that wrote `key` is gone (its page lock is free). What of its queue the
 * server does not have yet (`remainingQueue` against `server`; all of it when the server could
 * not be read or moved on) is parked for the user, never dropped and never merged silently into
 * this page's own edits. Returns whether anything was parked.
 */
export function takePeerQueue(
  storage: KeyValueStorage | null | undefined,
  key: string,
  projectId: string,
  server: ServerState | null,
): boolean {
  const q = readQueue(storage, key);
  let parked = false;
  if (q) {
    const left = server ? remainingQueue(q, server) : null;
    if (!left) {
      parkQueue(storage, projectId, q);
      parked = q.entries.length > 0;
    } else if (left.entries.length > 0) {
      const { unit: _unit, ...plain } = left;
      void _unit;
      parkQueue(storage, projectId, plain);
      parked = true;
    }
  }
  forget(storage, key);
  return parked;
}

/** What a page that holds the lock does with a left queue (B60 fix round 3, D-117 table). */
export type Takeover =
  | { action: 'none' }
  | { action: 'replay'; queue: StoredQueue }
  | { action: 'reload' }
  | { action: 'parked' };

/**
 * B60 (fix rounds 1 and 3): the page holds the Web Lock of the queue's key, so the page that wrote
 * it is gone (closed or crashed, whatever the queue's age). The decision is made against the
 * server's revision and `lastSaveId` read now (`server`; null when it could not be read), never
 * against the revision this tab loaded:
 * - what is left fits the server (`remainingQueue`) and the tab is current with nothing of its own
 *   unsent → replay; the tab is behind the server → reload first (the queue stays stored);
 * - it does not fit (someone else moved the server), the tab has unsent edits or a save on the
 *   way, or the server could not be read → parked for the user (never dropped).
 * A draft page (no project yet) replays against revision 0 (a repeated create is answered by its
 * save id). This page's own queue is never touched. Parked changes a gone page was applying are
 * settled here too (`settleApplying`).
 */
export function takeOverQueue(
  storage: KeyValueStorage | null | undefined,
  s: {
    id: string | null;
    newId?: string;
    server: ServerState | null;
    tab: { revision: number; busy: boolean };
    pageId: string;
    /** This page holds the lock of the draft the project came from too (default true). */
    draft?: boolean;
  },
): Takeover {
  if (s.id === null) forget(storage, queueKey(null)); // the shared key of earlier versions
  const keys =
    s.id === null
      ? s.newId
        ? [queueKey(null, s.newId)]
        : []
      : s.draft === false
        ? [queueKey(s.id)]
        : [queueKey(s.id), queueKey(null, s.id)];
  const server = s.id === null ? { revision: 0 } : s.server;
  let result: Takeover = { action: 'none' };
  const owners: string[] = [];
  for (const key of keys) {
    const q = readQueue(storage, key);
    if (!q) {
      forget(storage, key); // nothing, or not a queue (T020): never leave a corrupt one behind
      continue;
    }
    if (q.owner === s.pageId) continue;
    const draftKey = s.id !== null && key !== queueKey(s.id);
    if ((s.id === null || draftKey) && q.newId !== (s.id ?? s.newId)) {
      forget(storage, key); // another draft's queue under a key it does not own
      continue;
    }
    if (q.owner) owners.push(q.owner);
    const left = server ? remainingQueue(q, server) : null;
    if (!left || (s.tab.busy && s.id !== null)) {
      if (s.id !== null) {
        parkQueue(storage, s.id, q);
        result = { action: 'parked' };
      }
      forget(storage, key);
      continue;
    }
    if (server && s.id !== null && s.tab.revision !== server.revision) {
      // The tab is behind the server: it reloads first, the queue waits for it as it is.
      return { action: 'reload' };
    }
    forget(storage, key); // this page stores it under its own key right away (restore + claim)
    if (s.id !== null) settleApplying(storage, s.id, owners, server);
    return { action: 'replay', queue: left };
  }
  if (s.id !== null) settleApplying(storage, s.id, owners, server);
  return result;
}

/**
 * B60 r3: parked changes a gone page was applying. Its queue was handled above (replayed: they are
 * in it, so they go; parked again: `parkQueue` replaced them). No queue of that page left: they
 * go only when the server's last save is the applying one; otherwise they stay parked.
 */
function settleApplying(
  storage: KeyValueStorage | null | undefined,
  id: string,
  owners: readonly string[],
  server: ServerState | null,
): void {
  const parked = readQueue(storage, leftKey(id));
  const applying = parked?.applying;
  if (!applying) return;
  if (owners.includes(applying.owner)) {
    // Replayed: the parked copy is in this page's queue now, so it goes. (Parked again, `parkQueue`
    // already replaced it and the mark is gone: `applying` above would be undefined.)
    forget(storage, leftKey(id));
    return;
  }
  if (applying.saveId !== undefined && server?.lastSaveId === applying.saveId) {
    forget(storage, leftKey(id));
    return;
  }
  markParkedApplying(storage, id, null);
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
  private newId: string | undefined;
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
  /**
   * B60: liveness by Web Locks. `locked`: the page decides by its lock (not by age); `claimed`:
   * it holds the lock of its queue, so it is the only writer.
   */
  private locked = false;
  private claimed = false;
  /** B60 F1: the page holds its page lock (`pageLockName`): it may store a peer queue. */
  private pageLive = false;
  /**
   * B60 fix round 2: the key the queue is stored under. With locks it is the key whose lock the
   * page holds: a created project keeps its draft key until the page holds the project key's lock
   * (`adopt`); without locks it follows the id at once.
   */
  private key: string;
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
    this.key = queueKey(init.id, init.newId);
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
  /** The draft id of a project not created yet (T305; B60 r3: it may be renewed once). */
  get draftId(): string | undefined {
    return this.newId;
  }
  /** B60 r3: unsent edits of its own, or a save on the way. */
  get busy(): boolean {
    return this.dirty || this.inFlight;
  }
  /** B60 r3: the project whose parked changes this page is applying (until their save lands). */
  private applyingParked: string | null = null;
  get applying(): string | null {
    return this.applyingParked;
  }
  setApplying(id: string | null): void {
    this.applyingParked = id;
  }
  /** B60 r3: the save id of the unit on the way, if any. */
  get unitSaveId(): string | undefined {
    return this.unit?.saveId;
  }

  /**
   * B60 fix round 3: the draft id from the address belongs to a live tab (its lock is held): this
   * page takes a new draft id of its own before anything was edited or stored, so two tabs never
   * write under one draft or project identity (T305 / D-094, as before B60).
   */
  renewDraft(newId: string): boolean {
    if (this.id !== null || this.claimed || this.busy || this.unit || this.entries.length > 0) {
      return false;
    }
    this.newId = newId;
    this.key = queueKey(null, newId);
    return true;
  }

  /** B60 r2: the key the queue is stored under (the page holds that key's lock). */
  get storageKey(): string {
    return this.key;
  }
  /** Id of this page (owner of the stored queue it writes). */
  get ownerId(): string {
    return this.pageId;
  }

  /**
   * B60: the browser has Web Locks; until `claim` this page writes no stored queue another page
   * owns (a live tab, or a dead one whose changes are taken over first), whatever its age.
   */
  useLocks(): void {
    this.locked = true;
  }

  /** B60: this page now holds its queue's lock: it is the only writer. */
  claim(): void {
    this.claimed = true;
    this.persist();
    // B60 F1: what it stored as a peer moves under the key it holds now.
    if (this.id !== null) forget(this.deps.storage, peerKey(this.id, this.pageId));
  }

  /** B60 F1: the page holds its page lock now; a peer queue it stores is found if it dies. */
  markPageLive(): void {
    this.pageLive = true;
    this.persist();
  }

  /** B60 F1: this page holds the lock of its project's queue (it takes gone peers' queues). */
  get holdsLock(): boolean {
    return this.claimed && this.id !== null && this.key === queueKey(this.id);
  }

  /**
   * B60 F1: where the queue is stored now. A page waiting for the lock a live tab holds (a peer)
   * uses a key of its own, so it never overwrites that tab's queue nor has its own overwritten.
   */
  private storeKey(): string {
    if (this.locked && !this.claimed && this.id !== null && this.key === queueKey(this.id)) {
      return peerKey(this.id, this.pageId);
    }
    return this.key;
  }

  /**
   * B60 fix round 2: the page created its project under a draft key and now holds the lock of the
   * project key too: the queue moves there (the caller releases the draft key's lock after this).
   * A queue a gone page left under the project key is parked, never overwritten or dropped.
   */
  adopt(): void {
    if (this.disposed || this.id === null) return;
    const to = queueKey(this.id);
    if (this.key === to) return;
    const from = this.key;
    const left = readQueue(this.deps.storage, to);
    if (left && left.owner !== this.pageId) {
      parkQueue(this.deps.storage, this.id, left);
      forget(this.deps.storage, to);
    }
    this.key = to;
    this.claimed = true;
    this.persist();
    this.removeStored(from);
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
    this.removeStored(this.key);
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
      const oldKey = this.key;
      this.id = result.id;
      this.revision = result.revision;
      this.entries.splice(0, unit.count);
      this.unit = null;
      this.savedGeneration = unit.generation;
      this.attempt = 0;
      if (wasNew) {
        // B60 r2: with locks the queue stays under the draft key (whose lock this page holds)
        // until the page holds the project key's lock too (`adopt`); a live tab that opened the
        // project meanwhile keeps its own queue. Without locks it moves at once (T326 age rule).
        if (!this.locked) {
          this.removeStored(oldKey);
          this.key = queueKey(result.id);
        }
        // The stored queue reflects the create before the page reacts to it (a page being closed
        // may not get further than this).
        this.persist();
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
    if (this.id !== null && key === peerKey(this.id, this.pageId)) return true;
    // B60 r2: the lock this page holds is the one of its own key, not of any other.
    if (this.claimed && key === this.key) return true;
    const q = readQueue(this.deps.storage, key);
    if (!q || q.owner === this.pageId) return true;
    if (this.locked) return false;
    return !heldByLivePage(q, this.now());
  }

  private persist(): void {
    const key = this.storeKey();
    // B60 F1: a peer stores its queue only once its page lock shows it alive.
    if (key !== this.key && !this.pageLive) return;
    const draft = this.newId !== undefined && key === queueKey(null, this.newId);
    if (!this.dirty) {
      this.removeStored(key);
      return;
    }
    if (!this.mayWrite(key)) return;
    const q: StoredQueue = {
      baseRevision: this.revision,
      entries: this.entries,
      name: this.name,
      // A draft key names its draft (also after the create, until the queue moves: D-094).
      ...(draft && this.newId ? { newId: this.newId } : {}),
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
  /** B60: changes of a saved project that no longer fit the server (parked, not a draft). */
  parked?: true;
}

const DRAFT_KEY = /^nittcam\.unsent\.new\.([0-9a-f-]{36})$/;
const PARKED_KEY = /^nittcam\.unsent\.left\.([0-9a-f-]{36})$/;

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
    const parked = PARKED_KEY.exec(key)?.[1];
    if (parked) {
      const q = parkedQueue(storage, parked);
      if (q) out.push({ draftId: parked, name: q.name, changes: q.entries.length, parked: true });
      continue;
    }
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
    storage?.removeItem(leftKey(draftId));
  } catch {
    // Blocked storage: nothing stored either.
  }
}

/**
 * T020 under B60: a value under `key` that is not a queue is removed (no page ever writes one, so
 * no live page loses anything). A page that peeks before it holds the lock calls this, since it
 * may never take that key over (a new draft id when the address's draft has no queue).
 */
export function dropCorruptQueue(storage: KeyValueStorage | null | undefined, key: string): void {
  try {
    if (storage?.getItem(key) != null && !readQueue(storage, key)) forget(storage, key);
  } catch {
    // Storage is a convenience.
  }
}

/** The address parameter that names a new project's draft (T305, D-094). Kept here, not in
 * `project-session.ts`, so /projeler does not pull the wizard's session code (B42 budget). */
export const DRAFT_PARAM = 'taslak';

/** The stored queue under `key`, or null (B60: a page peeks before it holds the lock). */
export function storedQueue(
  storage: KeyValueStorage | null | undefined,
  key: string,
): StoredQueue | null {
  return readQueue(storage, key);
}
