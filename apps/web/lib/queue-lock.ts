/**
 * B60 (D-117): which page owns a stored unsent queue is decided by the Web Locks API. A page holds
 * the lock named after the key its queue is stored under for as long as it lives; the browser
 * frees it when the page dies (crash included).
 *
 * Fix round 2: the page holds the lock of the key its queue is actually stored under at every
 * moment. When its first save turns a draft into a project, it gets the project key's lock first,
 * then moves the queue, and only then lets the draft key's lock go (never a moment with neither).
 * A live tab that already holds the project key's lock keeps it: this page then neither moves nor
 * overwrites that tab's queue, keeps its own under the draft key and saves with the revision lock
 * (a conflict if that tab saved first); it moves once the other tab is gone.
 */
import { queueKey } from './autosave';

/** The part of `navigator.locks` used here (a fake in unit tests). */
export interface LockApi {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

/** Lock name of a stored queue: held by the page that writes it, for as long as it lives. */
export function queueLockName(id: string | null, newId?: string): string {
  return 'nittcam-queue:' + queueKey(id, newId);
}

type Release = () => void;

/**
 * Holds the lock `name` until the returned release is called. With `ifAvailable`, resolves with
 * null when another page holds it; otherwise waits for it (rejects when `signal` aborts first).
 */
export function holdLock(
  locks: LockApi,
  name: string,
  options: { ifAvailable?: boolean; signal?: AbortSignal },
): Promise<Release | null> {
  return new Promise<Release | null>((resolve, reject) => {
    locks
      .request(name, options, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        let release: Release = () => {};
        const held = new Promise<void>((r) => (release = r));
        resolve(release);
        return held;
      })
      .catch(reject);
  });
}

export interface QueueLockHooks {
  /**
   * The page holds the lock of its queue: whoever wrote a stored queue under it is gone, so it is
   * taken over now. `draft`: for a saved project, the lock of the draft it was created from was
   * free too, so that draft's queue may be taken as well (otherwise its live page still owns it);
   * always true for a draft page (its own key is the draft key).
   */
  onGrant(draft: boolean): void | Promise<void>;
  /**
   * B60 r3, draft pages: the draft id from the address belongs to a live tab (its lock is held).
   * Returns a new draft id for this page (its lock is taken instead), or null to wait as before.
   */
  onDraftBusy?(): string | null;
  /** Another live page holds the lock: this page waits for it (edits may start meanwhile). */
  onWait(): void;
  /** The page holds the project key's lock now: its queue moves there (`AutosaveQueue.adopt`). */
  onMoved(): void;
  /** The browser refused the lock (not a held one): the page goes on without a takeover. */
  onError(): void;
}

/**
 * Takes and holds the queue lock of a page opened on `id` (or the draft `newId`) and moves it to
 * the project key once the draft is created (`created`). `dispose` (unmount, navigation to another
 * project) lets every held lock go.
 */
export function holdQueueLocks(
  locks: LockApi,
  start: { id: string | null; newId?: string },
  hooks: QueueLockHooks,
): { created(id: string): void; dispose(): void } {
  const abort = new AbortController();
  const held = new Set<Release>();
  let gone = false;
  /** Resolves with the release of the queue's current lock once the page holds it. */
  let current: Promise<Release | null>;

  const keep = (release: Release | null): Release | null => {
    if (!release) return null;
    if (gone) {
      release();
      return null;
    }
    held.add(release);
    return release;
  };
  const drop = (release: Release | null) => {
    if (!release) return;
    held.delete(release);
    release();
  };
  /** The lock at once if free; otherwise `busy()` and then wait for it. */
  const take = async (name: string, busy: () => void): Promise<Release | null> => {
    const now = keep(await holdLock(locks, name, { ifAvailable: true }));
    if (now || gone) return now;
    busy();
    return keep(await holdLock(locks, name, { signal: abort.signal }));
  };

  current = (async () => {
    try {
      let name = queueLockName(start.id, start.newId);
      let early: Release | null = null;
      if (start.id === null && hooks.onDraftBusy) {
        // A copied ?taslak= address: never share a live tab's draft, take an own one (T305).
        early = keep(await holdLock(locks, name, { ifAvailable: true }));
        if (!early && !gone) {
          const renewed = hooks.onDraftBusy();
          if (renewed) name = queueLockName(null, renewed);
        }
      }
      if (gone) return null;
      const release =
        early ??
        (await take(name, () => {
          if (!gone) hooks.onWait();
        }));
      if (!release) return null;
      // A saved project may take the queue of the draft it was created from only while it also
      // holds that draft's lock (the page that created it is gone).
      const draft =
        start.id !== null
          ? keep(await holdLock(locks, queueLockName(null, start.id), { ifAvailable: true }))
          : null;
      if (gone) return null;
      await hooks.onGrant(start.id === null || draft !== null);
      drop(draft);
      return release;
    } catch {
      if (!gone) hooks.onError();
      return null;
    }
  })();

  return {
    created(id: string) {
      if (start.id !== null) return;
      const before = current;
      current = (async () => {
        const draft = await before;
        if (gone) return null;
        try {
          // Project key first, then move, then let the draft key go: never a moment with neither.
          const release = await take(queueLockName(id), () => {});
          if (!release || gone) return null;
          hooks.onMoved();
          drop(draft);
          return release;
        } catch {
          // Aborted (the page left): its locks go with it.
          return null;
        }
      })();
    },
    dispose() {
      gone = true;
      abort.abort();
      for (const release of held) release();
      held.clear();
    },
  };
}
