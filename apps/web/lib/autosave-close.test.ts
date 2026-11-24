/**
 * T326 (D-117): nothing accepted is lost when the page closes. The usta report: a rectangle drawn
 * ~1 s before closing the tab ("Kaydediliyor" on screen) was gone after reopening.
 */
import type { CommandLogEntry, Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  AutosaveQueue,
  defaultRetryMs,
  queueKey,
  discardLeftDraft,
  leftKey,
  parkedQueue,
  peerKey,
  peerQueueKeys,
  takePeerQueue,
  takeOverQueue,
  leftDrafts,
  STALE_MS,
  takeUnsentQueue,
  storedQueue,
  type KeyValueStorage,
  type SaveRequest,
  type SendResult,
  type StoredQueue,
} from './autosave';
import { holdQueueLocks, queueLockName, type LockApi } from './queue-lock';

const AT = '2026-11-23T10:00:00.000+03:00';
const NOW = 1_000_000;
const e = (command: string): CommandLogEntry => ({ command, params: {}, actor: 'user', at: AT });
const P = (n: number) => ({ n }) as unknown as Project;
const settle = () => new Promise((r) => setTimeout(r, 0));
const D = '7d3f0e1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';

function clock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    async advance(ms: number) {
      now += ms;
      for (const [h, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(h)) {
          timers.delete(h);
          t.fn();
          await settle();
        }
      }
    },
  };
}

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** A server with the revision lock and the repeat rule of `projects.save` / the create route. */
function fakeServer() {
  const srv = {
    exists: false,
    revision: 0,
    lastSaveId: null as string | null,
    log: [] as string[],
    /** The request reaches the server, but the page never sees the answer (it is gone). */
    lose: false,
    /** The request never reaches the server (offline, or cancelled with the page). */
    drop: false,
    /** The request fails at once (offline), the page retries later. */
    fail: false,
    apply(req: SaveRequest): SendResult {
      const id = req.id ?? req.newId ?? 'x';
      if (req.id === null) {
        if (srv.exists) {
          return srv.revision === 1 && srv.lastSaveId === req.saveId
            ? { ok: true, id, revision: 1 }
            : { ok: false, kind: 'conflict' };
        }
        srv.exists = true;
        srv.revision = 1;
      } else if (srv.revision === req.baseRevision) {
        srv.revision += 1;
      } else if (srv.revision === req.baseRevision + 1 && srv.lastSaveId === req.saveId) {
        return { ok: true, id, revision: srv.revision }; // a repeat: answered, not applied
      } else {
        return { ok: false, kind: 'conflict' };
      }
      srv.lastSaveId = req.saveId;
      srv.log.push(...req.commands.map((c) => c.command));
      return { ok: true, id, revision: srv.revision };
    },
    send(req: SaveRequest): Promise<SendResult> {
      if (srv.drop) return new Promise<SendResult>(() => {});
      if (srv.fail) return Promise.resolve({ ok: false, kind: 'network' });
      const r = srv.apply(req);
      return srv.lose ? new Promise<SendResult>(() => {}) : Promise.resolve(r);
    },
  };
  return srv;
}
type Server = ReturnType<typeof fakeServer>;

let ids = 0;
function page(
  storage: KeyValueStorage,
  srv: Server,
  init: { id: string | null; revision: number; newId?: string },
) {
  const c = clock();
  const sent: SaveRequest[] = [];
  const q = new AutosaveQueue(
    {
      send: (req) => {
        sent.push({ ...req, commands: [...req.commands] });
        return srv.send(req);
      },
      storage,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      pageId: `page-${++ids}`,
      now: () => NOW,
      newSaveId: () => `save-${++ids}`,
    },
    { ...init, name: 'Proje', project: P(0) },
  );
  return { q, c, sent };
}

/** What `useProjectSession` does on boot: take the stored queue and hand it to the new page. */
function reopen(storage: KeyValueStorage, srv: Server, id: string | null, newId?: string) {
  const server =
    id === null ? { revision: 0 } : { revision: srv.revision, lastSaveId: srv.lastSaveId };
  const stored = takeUnsentQueue(storage, id, server, newId, NOW + 1);
  const next = page(storage, srv, {
    id,
    revision: id === null ? 0 : srv.revision,
    ...(newId ? { newId } : {}),
  });
  if (stored && stored.entries.length > 0) {
    next.q.restore({
      entries: stored.entries,
      project: P(stored.entries.length),
      name: stored.name,
      ...(stored.unit ? { unit: { ...stored.unit, project: P(stored.unit.count) } } : {}),
    });
  }
  return { ...next, stored };
}

function savedProject(): Server {
  const srv = fakeServer();
  srv.exists = true;
  srv.revision = 1;
  return srv;
}

describe('T326: save units', () => {
  it('a failed unit is resent unchanged (same id, same project) while later changes wait', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    let fail = true;
    const { q, c, sent } = page(
      storage,
      {
        ...srv,
        send: (r) =>
          fail
            ? ((fail = false), Promise.resolve({ ok: false, kind: 'network' } as SendResult))
            : srv.send(r),
      } as Server,
      { id: 'p1', revision: 1 },
    );
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    q.push({ entries: [e('b')], project: P(2) });
    await c.advance(defaultRetryMs(1));
    expect(sent[1]?.saveId).toBe(sent[0]?.saveId);
    expect(sent[1]?.commands.map((x) => x.command)).toEqual(['a']);
    expect(sent[1]?.project).toEqual(P(1));
    await c.advance(1000);
    expect(sent[2]?.commands.map((x) => x.command)).toEqual(['b']);
    expect(sent[2]?.saveId).not.toBe(sent[0]?.saveId);
    expect(sent[2]).toMatchObject({ baseRevision: 2 });
    expect(srv.log).toEqual(['a', 'b']);
    expect(q.state).toBe('saved');
  });

  it('the stored queue names the unit on the way, its page and whether it was closed', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    srv.lose = true;
    const { q, c } = page(storage, srv, { id: 'p1', revision: 1 });
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    q.push({ entries: [e('b')], project: P(2) });
    const stored = JSON.parse(storage.getItem(queueKey('p1')) ?? '{}') as StoredQueue;
    expect(stored).toMatchObject({ baseRevision: 1, unit: { count: 1 }, at: NOW });
    expect(stored.entries.map((x) => x.command)).toEqual(['a', 'b']);
    expect(stored.closed).toBeUndefined();
    q.closing();
    expect(JSON.parse(storage.getItem(queueKey('p1')) ?? '{}')).toMatchObject({ closed: true });
  });

  it('closing inside the debounce window sends at once', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const { q, sent } = page(storage, srv, { id: 'p1', revision: 1 });
    q.push({ entries: [e('rect')], project: P(1) });
    q.closing();
    await settle();
    expect(sent).toHaveLength(1);
    expect(srv.log).toEqual(['rect']);
    expect(storage.getItem(queueKey('p1'))).toBeNull();
  });

  it('closing while a unit is on the way resends that unit with keepalive, then the rest', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const waiting: (() => void)[] = [];
    const slow = {
      ...srv,
      send: (r: SaveRequest) =>
        new Promise<SendResult>((ok) => waiting.push(() => ok(srv.apply(r)))),
    };
    const { q, c, sent } = page(storage, slow as Server, { id: 'p1', revision: 1 });
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    q.push({ entries: [e('b')], project: P(2) });
    q.closing();
    await settle();
    // The same unit once more, able to outlive the page; never the later change on a guess.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ saveId: sent[0]?.saveId, keepalive: true, baseRevision: 1 });
    expect(sent[1]?.commands.map((x) => x.command)).toEqual(['a']);
    waiting.shift()?.(); // the first lands
    await settle();
    await settle();
    // The page lives on (back/forward cache, or a slow unload): the rest goes at once.
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ baseRevision: 2, keepalive: true });
    waiting.shift()?.(); // the repeat is answered, not applied
    waiting.shift()?.();
    await settle();
    expect(srv.log).toEqual(['a', 'b']);
    expect(q.state).toBe('saved');
  });
});

describe('T326: the next page (reload, new tab, after a crash) gets every change exactly once', () => {
  // Whether the unit on the way reached the server or not, the next page ends with every
  // command on the server exactly once.
  for (const reached of [true, false]) {
    it(`saved project, "Kaydediliyor" when closed, unit ${reached ? 'reached' : 'never arrived'}`, async () => {
      const storage = memoryStorage();
      const srv = savedProject();
      const one = page(storage, srv, { id: 'p1', revision: 1 });
      one.q.push({ entries: [e('rect')], project: P(1) });
      if (reached) srv.lose = true;
      else srv.drop = true;
      await one.c.advance(1000); // the unit is on the way, no answer
      one.q.push({ entries: [e('resize')], project: P(2) });
      one.q.closing(); // a save is on the way: nothing more is sent now
      expect(one.sent).toHaveLength(1);
      one.q.dispose();

      srv.lose = false;
      srv.drop = false;
      const two = reopen(storage, srv, 'p1');
      expect(two.stored).not.toBeNull();
      await two.c.advance(1000);
      await two.c.advance(1000);
      expect(srv.log).toEqual(['rect', 'resize']);
      expect(two.q.state).toBe('saved');
      expect(storage.getItem(queueKey('p1'))).toBeNull();
    });
  }

  it('a unit landing after the next page read the project is answered, not applied twice', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const one = page(storage, srv, { id: 'p1', revision: 1 });
    one.q.push({ entries: [e('rect')], project: P(1) });
    srv.drop = true;
    await one.c.advance(1000);
    one.q.closing();
    one.q.dispose();
    srv.drop = false;
    // The next page reads revision 1; then the close-time request lands (slow network).
    const stored = takeUnsentQueue(
      storage,
      'p1',
      { revision: 1, lastSaveId: null },
      undefined,
      NOW,
    );
    expect(stored?.unit?.count).toBe(1);
    srv.apply(one.sent[0] as SaveRequest);
    const two = page(storage, srv, { id: 'p1', revision: 1 });
    two.q.restore({
      entries: stored?.entries ?? [],
      project: P(1),
      name: 'Proje',
      unit: { saveId: stored?.unit?.saveId ?? '', count: 1, project: P(1) },
    });
    await two.c.advance(1000);
    expect(two.sent[0]?.saveId).toBe(one.sent[0]?.saveId);
    expect(srv.log).toEqual(['rect']);
    expect(two.q.state).toBe('saved');
    expect(two.q.baseRevision).toBe(2);
  });

  it('takes only what came after a unit that reached the server', () => {
    const storage = memoryStorage();
    const q: StoredQueue = {
      baseRevision: 3,
      entries: [e('a'), e('b')],
      name: 'X',
      unit: { saveId: 'S1', count: 1 },
      owner: 'old',
      at: NOW,
      closed: true,
    };
    storage.setItem(queueKey('p1'), JSON.stringify(q));
    const left = takeUnsentQueue(storage, 'p1', { revision: 4, lastSaveId: 'S1' }, undefined, NOW);
    expect(left).toMatchObject({ baseRevision: 4, name: 'X' });
    expect(left?.entries.map((x) => x.command)).toEqual(['b']);
    expect(left?.unit).toBeUndefined();
    // Another save made revision 4: the queue is stale and dropped.
    expect(
      takeUnsentQueue(storage, 'p1', { revision: 4, lastSaveId: 'S9' }, undefined, NOW),
    ).toBeNull();
    expect(storage.getItem(queueKey('p1'))).toBeNull();
  });

  it('leaves a queue another open page still writes; takes it once closed or stale', () => {
    const storage = memoryStorage();
    const q = (extra: Partial<StoredQueue>) =>
      JSON.stringify({ baseRevision: 2, entries: [e('a')], name: 'X', owner: 'tab-a', ...extra });
    storage.setItem(queueKey('p1'), q({ at: NOW }));
    expect(takeUnsentQueue(storage, 'p1', 2, undefined, NOW + 1000)).toBeNull();
    // A live page's queue on another revision is not dropped either (its save may be landing).
    expect(takeUnsentQueue(storage, 'p1', 3, undefined, NOW + 1000)).toBeNull();
    expect(storage.getItem(queueKey('p1'))).not.toBeNull();
    expect(takeUnsentQueue(storage, 'p1', 2, undefined, NOW + STALE_MS)?.entries).toHaveLength(1);
    storage.setItem(queueKey('p1'), q({ at: NOW, closed: true }));
    expect(takeUnsentQueue(storage, 'p1', 2, undefined, NOW + 1)?.entries).toHaveLength(1);
    // A queue of an earlier version (no page named) is taken as before.
    storage.setItem(
      queueKey('p1'),
      JSON.stringify({ baseRevision: 2, entries: [e('a')], name: 'X' }),
    );
    expect(takeUnsentQueue(storage, 'p1', 2, undefined, NOW)?.entries).toHaveLength(1);
  });

  it('a second open page never overwrites or removes the queue of a live page', () => {
    const storage = memoryStorage();
    const srv = savedProject();
    srv.lose = true;
    const a = page(storage, srv, { id: 'p1', revision: 1 });
    a.q.push({ entries: [e('a')], project: P(1) });
    const before = storage.getItem(queueKey('p1'));
    const b = page(storage, srv, { id: 'p1', revision: 1 });
    b.q.push({ entries: [e('b')], project: P(1) });
    expect(storage.getItem(queueKey('p1'))).toBe(before);
    b.q.discard();
    expect(storage.getItem(queueKey('p1'))).toBe(before);
  });
});

describe('T326: a new project (draft) closed before its first save came back', () => {
  it('its create reached the server: opening the project replays the rest', async () => {
    const storage = memoryStorage();
    const srv = fakeServer();
    const one = page(storage, srv, { id: null, revision: 0, newId: D });
    one.q.push({ entries: [e('rect')], project: P(1) });
    srv.lose = true;
    await one.c.advance(1000); // the create reaches the server; its answer never comes back
    one.q.push({ entries: [e('hole')], project: P(2) });
    one.q.closing();
    one.q.dispose();
    expect(srv.log).toEqual(['rect']);
    srv.lose = false;
    // From the project list: the project exists, its page finds the draft's queue.
    const two = reopen(storage, srv, D);
    expect(two.stored?.entries.map((x) => x.command)).toEqual(['hole']);
    await two.c.advance(1000);
    expect(srv.log).toEqual(['rect', 'hole']);
    expect(storage.getItem(queueKey(null, D))).toBeNull();
    expect(storage.getItem(queueKey(D))).toBeNull();
  });

  it('its create never arrived: the draft address brings it back and creates it', async () => {
    const storage = memoryStorage();
    const srv = fakeServer();
    srv.drop = true; // offline
    const one = page(storage, srv, { id: null, revision: 0, newId: D });
    one.q.push({ entries: [e('rect')], project: P(1) });
    one.q.closing();
    await settle();
    one.q.dispose();
    srv.drop = false;
    const two = reopen(storage, srv, null, D);
    await two.c.advance(1000);
    expect(srv.log).toEqual(['rect']);
    expect(two.q.projectId).toBe(D);
  });

  it('reopened from its draft address after the project moved on: conflict, never an overwrite', async () => {
    const storage = memoryStorage();
    const srv = fakeServer();
    const one = page(storage, srv, { id: null, revision: 0, newId: D });
    one.q.push({ entries: [e('rect')], project: P(1) });
    srv.lose = true;
    await one.c.advance(1000);
    one.q.closing();
    one.q.dispose();
    srv.lose = false;
    srv.revision = 3; // edited in the saved project since
    srv.lastSaveId = 'other';
    const two = reopen(storage, srv, null, D);
    await two.c.advance(1000);
    expect(two.q.state).toBe('conflict');
    expect(srv.log).toEqual(['rect']);
  });
});

describe('T326: Projeler offers a draft left before the server had it', () => {
  it('lists closed or stale drafts with changes; not live pages, saved projects or empty ones', () => {
    const storage = memoryStorage();
    const keys: string[] = [];
    const put = (key: string, q: Partial<StoredQueue>) => {
      keys.push(key);
      storage.setItem(
        key,
        JSON.stringify({ baseRevision: 0, entries: [e('a')], name: 'Taslak', ...q }),
      );
    };
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    const C = '33333333-3333-4333-8333-333333333333';
    put(queueKey(null, A), { newId: A, owner: 'x', at: NOW, closed: true });
    put(queueKey(null, B), { newId: B, owner: 'y', at: NOW }); // still open in another tab
    put(queueKey(null, C), { newId: C, entries: [] });
    put(queueKey('p1'), { baseRevision: 2 });
    keys.push('other');
    expect(leftDrafts(storage, keys, NOW + 1)).toEqual([
      { draftId: A, name: 'Taslak', changes: 1 },
    ]);
    expect(leftDrafts(storage, keys, NOW + STALE_MS).map((d) => d.draftId)).toEqual([A, B]);
  });

  it('"Taslağı sil" (after the confirm) removes only that draft; blocked storage is ignored', () => {
    const storage = memoryStorage();
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    for (const id of [A, B]) {
      storage.setItem(
        queueKey(null, id),
        JSON.stringify({
          baseRevision: 0,
          entries: [e('a')],
          name: 'Taslak',
          newId: id,
          closed: true,
        }),
      );
    }
    storage.setItem(queueKey('p1'), '{}');
    discardLeftDraft(storage, A);
    expect(storage.getItem(queueKey(null, A))).toBeNull();
    expect(storage.getItem(queueKey(null, B))).not.toBeNull();
    expect(storage.getItem(queueKey('p1'))).toBe('{}');
    const blocked: KeyValueStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => discardLeftDraft(blocked, A)).not.toThrow();
    expect(() => discardLeftDraft(null, A)).not.toThrow();
  });
});

/**
 * B60 fix round 1 (PO): liveness by Web Locks. A page that gets its queue's lock knows the writer
 * is gone (crash included) and takes the queue over at once, whatever its age; a page that does
 * not get it (a live tab holds it) neither takes nor writes that queue.
 */
describe('B60: crash, then reopen (Web Locks)', () => {
  /** A page opened with locks; `grant` = the lock was free (the earlier page is gone). */
  function lockedPage(storage: KeyValueStorage, srv: Server, id: string, at: number) {
    const next = page(storage, srv, { id, revision: srv.revision });
    next.q.useLocks();
    void at;
    const grant = () => {
      const t = takeOverQueue(storage, {
        id,
        server: { revision: srv.revision, lastSaveId: srv.lastSaveId },
        tab: { revision: next.q.baseRevision, busy: next.q.busy },
        pageId: next.q.ownerId,
      });
      const stored = t.action === 'replay' ? t.queue : null;
      if (stored && stored.entries.length > 0) {
        next.q.restore({
          entries: stored.entries,
          project: P(stored.entries.length),
          name: stored.name,
          ...(stored.unit ? { unit: { ...stored.unit, project: P(stored.unit.count) } } : {}),
        });
      }
      next.q.claim();
    };
    return { ...next, grant };
  }

  /** Page A draws "rect" while saves never arrive; then the tab crashes (no pagehide). */
  function crashed(id = 'p1') {
    const storage = memoryStorage();
    const srv = savedProject();
    const a = page(storage, srv, { id, revision: 1 });
    srv.drop = true;
    a.q.push({ entries: [e('rect')], project: P(1) });
    void a.c.advance(1000);
    a.q.dispose(); // crash: no closing(), the queue keeps owner and a fresh time
    srv.drop = false;
    return { storage, srv };
  }

  for (const [label, after] of [
    ['0 s', 0],
    ['5 s', 5_000],
    ['20 s', 20_000],
  ] as const) {
    it(`reopened after ${label}: the crashed edit is replayed first, then new edits; each once`, async () => {
      const { storage, srv } = crashed();
      const b = lockedPage(storage, srv, 'p1', NOW + after);
      b.grant();
      expect(b.q.pending.map((x) => x.command)).toEqual(['rect']);
      await b.c.advance(1000);
      expect(srv.log).toEqual(['rect']);
      b.q.push({ entries: [e('more')], project: P(2) });
      await b.c.advance(1000);
      expect(srv.log).toEqual(['rect', 'more']);
      expect(srv.revision).toBe(3);
      // Closed and opened again later: nothing left, nothing twice.
      b.q.dispose();
      const c = lockedPage(storage, srv, 'p1', NOW + after + 60_000);
      c.grant();
      expect(c.q.pending).toEqual([]);
      expect(parkedQueue(storage, 'p1')).toBeNull();
    });

    it(`reopened after ${label} without new edits: replayed once`, async () => {
      const { storage, srv } = crashed();
      const b = lockedPage(storage, srv, 'p1', NOW + after);
      b.grant();
      await b.c.advance(1000);
      expect(srv.log).toEqual(['rect']);
      expect(b.q.dirty).toBe(false);
    });
  }

  it('a page that saved its own edit before it got the lock parks the left queue, never drops it', async () => {
    const { storage, srv } = crashed(D);
    const b = lockedPage(storage, srv, D, NOW);
    b.q.push({ entries: [e('mine')], project: P(1) });
    await b.c.advance(1000);
    expect(srv.log).toEqual(['mine']);
    b.grant();
    expect(b.q.pending).toEqual([]);
    expect(parkedQueue(storage, D)?.entries.map((x) => x.command)).toEqual(['rect']);
    expect(leftDrafts(storage, [leftKey(D)], NOW)).toEqual([
      { draftId: D, name: 'Proje', changes: 1, parked: true },
    ]);
    // "Taslağı sil" on Projeler removes the parked changes too.
    discardLeftDraft(storage, D);
    expect(parkedQueue(storage, D)).toBeNull();
  });

  it('two live tabs: the page without the lock neither takes nor overwrites the other queue', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const a = page(storage, srv, { id: 'p1', revision: 1 });
    a.q.useLocks();
    a.q.claim();
    srv.drop = true;
    a.q.push({ entries: [e('a1')], project: P(1) });
    await a.c.advance(1000);
    srv.drop = false;
    // Tab B opens while A lives: no lock, so no takeover (whatever the queue's age).
    const b = page(storage, srv, { id: 'p1', revision: 1 });
    b.q.useLocks();
    b.q.push({ entries: [e('b1')], project: P(1) });
    await b.c.advance(1000);
    expect(srv.log).toEqual(['b1']);
    const stored = JSON.parse(storage.getItem(queueKey('p1')) ?? '{}') as StoredQueue;
    expect(stored.entries.map((x) => x.command)).toEqual(['a1']);
  });

  it('without locks a stale queue is parked, not dropped (server moved on)', () => {
    const storage = memoryStorage();
    storage.setItem(
      queueKey('p1'),
      JSON.stringify({ baseRevision: 1, entries: [e('old')], name: 'Proje', closed: true }),
    );
    expect(takeUnsentQueue(storage, 'p1', { revision: 3 }, undefined, NOW)).toBeNull();
    expect(storage.getItem(queueKey('p1'))).toBeNull();
    expect(parkedQueue(storage, 'p1')?.entries.map((x) => x.command)).toEqual(['old']);
  });
});

/**
 * B60 fix round 2: the page holds the lock of the key its queue is stored under at every moment.
 * A draft that becomes a project takes the project key's lock first, then moves the queue, then
 * lets the draft key's lock go; a live tab that owns the project key keeps its queue.
 */
describe('B60 r2: the queue lock follows the queue key', () => {
  /** A fake `navigator.locks`: exclusive locks, `ifAvailable`, waiters in order, `signal`. */
  function fakeLocks() {
    const holders = new Set<string>();
    const waiters = new Map<string, Array<() => void>>();
    const grant = (name: string, cb: (lock: unknown) => unknown): Promise<unknown> => {
      holders.add(name);
      return Promise.resolve(cb({ name })).finally(() => {
        holders.delete(name);
        waiters.get(name)?.shift()?.();
      });
    };
    const api: LockApi = {
      request(name, options, cb) {
        if (!holders.has(name)) return grant(name, cb);
        if (options.ifAvailable) return Promise.resolve(cb(null));
        return new Promise((resolve, reject) => {
          const go = () => void grant(name, cb).then(resolve, reject);
          const list = waiters.get(name) ?? [];
          list.push(go);
          waiters.set(name, list);
          options.signal?.addEventListener('abort', () => {
            const i = list.indexOf(go);
            if (i >= 0) list.splice(i, 1);
            reject(new Error('aborted'));
          });
        });
      },
    };
    /** Another live page holding `name` until the returned function is called. */
    const holdElsewhere = (name: string) => {
      let letGo: () => void = () => {};
      void api.request(name, {}, () => new Promise<void>((r) => (letGo = r)));
      return () => letGo();
    };
    return { api, held: (name: string) => holders.has(name), holdElsewhere };
  }

  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await settle();
  };

  /** What `useProjectSession` wires with locks: grant → take over + claim; moved → adopt. */
  function session(
    locks: LockApi,
    storage: KeyValueStorage,
    srv: Server,
    init: { id: string | null; revision: number; newId?: string },
  ) {
    const p = page(storage, srv, init);
    p.q.useLocks();
    const events: string[] = [];
    const holder = holdQueueLocks(
      locks,
      { id: init.id, ...(init.newId ? { newId: init.newId } : {}) },
      {
        onGrant: (draft) => {
          events.push(draft ? 'grant' : 'grant-no-draft');
          const t = takeOverQueue(storage, {
            id: p.q.projectId,
            ...(p.q.draftId ? { newId: p.q.draftId } : {}),
            server: p.q.projectId ? { revision: srv.revision, lastSaveId: srv.lastSaveId } : null,
            tab: { revision: p.q.baseRevision, busy: p.q.busy },
            pageId: p.q.ownerId,
            draft,
          });
          if (t.action === 'reload') {
            events.push('reload');
            return;
          }
          const left = t.action === 'replay' ? t.queue : null;
          if (left && left.entries.length > 0) {
            p.q.restore({
              entries: left.entries,
              project: P(left.entries.length),
              name: left.name,
              ...(left.unit ? { unit: { ...left.unit, project: P(left.unit.count) } } : {}),
            });
          }
          p.q.claim();
        },
        onWait: () => events.push('wait'),
        onMoved: () => {
          events.push('moved');
          p.q.adopt();
        },
        onError: () => events.push('error'),
      },
    );
    p.q.setOnCreated((id) => holder.created(id));
    /** Tab crash or navigation away: the queue stays as stored, every lock goes. */
    const leave = () => {
      p.q.dispose();
      holder.dispose();
    };
    return { ...p, events, leave };
  }

  const stored = (storage: KeyValueStorage, key: string) => {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredQueue) : null;
  };
  const commands = (q: StoredQueue | null) => q?.entries.map((x) => x.command);
  const draftLock = queueLockName(null, D);
  const projectLock = queueLockName(D);

  /** Tab A: Yeni proje, its first save creates `D`. */
  async function createdInA() {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = fakeServer();
    const a = session(locks.api, storage, srv, { id: null, revision: 0, newId: D });
    await flush();
    a.q.push({ entries: [e('parts')], project: P(1) });
    await a.c.advance(1000);
    await flush();
    return { locks, storage, srv, a };
  }

  /** A draws "rect" that does not reach the server. */
  async function unsentRect(
    srv: Server,
    a: { q: AutosaveQueue; c: { advance(ms: number): Promise<void> } },
  ) {
    srv.fail = true;
    a.q.push({ entries: [e('rect')], project: P(2) });
    await a.c.advance(1000);
    srv.fail = false;
  }

  it('created in this tab: the project key lock is held before the draft lock goes', async () => {
    const { locks, storage, srv, a } = await createdInA();
    expect(srv.log).toEqual(['parts']);
    expect(a.events).toEqual(['grant', 'moved']);
    expect(a.q.storageKey).toBe(queueKey(D));
    expect(locks.held(projectLock)).toBe(true);
    expect(locks.held(draftLock)).toBe(false);
    await unsentRect(srv, a);
    expect(stored(storage, queueKey(D))?.owner).toBe(a.q.ownerId);
    expect(stored(storage, queueKey(null, D))).toBeNull();
  });

  it('created in tab A, opened in tab B while A lives: B waits, A keeps its queue and saves', async () => {
    const { locks, storage, srv, a } = await createdInA();
    await unsentRect(srv, a);
    const b = session(locks.api, storage, srv, { id: D, revision: srv.revision });
    await flush();
    expect(b.events).toEqual(['wait']);
    expect(b.q.pending).toEqual([]);
    expect(srv.log).toEqual(['parts']);
    expect(commands(stored(storage, queueKey(D)))).toEqual(['rect']);
    // A is still the base: its next save goes through without a conflict.
    await a.q.flush();
    expect(a.q.state).toBe('saved');
    expect(srv.log).toEqual(['parts', 'rect']);
    a.leave();
    await flush();
    expect(b.events).toEqual(['wait', 'grant']);
    expect(b.q.pending).toEqual([]);
  });

  it('created in tab A, which then crashes: B takes the queue over once', async () => {
    const { locks, storage, srv, a } = await createdInA();
    await unsentRect(srv, a);
    const b = session(locks.api, storage, srv, { id: D, revision: srv.revision });
    await flush();
    a.leave();
    await flush();
    expect(b.q.pending.map((x) => x.command)).toEqual(['rect']);
    await b.c.advance(1000);
    expect(srv.log).toEqual(['parts', 'rect']);
  });

  it('a live tab already owns the project key: no move, no overwrite; the move follows later', async () => {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = fakeServer();
    const a = session(locks.api, storage, srv, { id: null, revision: 0, newId: D });
    await flush();
    const letGo = locks.holdElsewhere(projectLock);
    storage.setItem(
      queueKey(D),
      JSON.stringify({
        baseRevision: 1,
        entries: [e('theirs')],
        name: 'Proje',
        owner: 'x',
        at: NOW,
      }),
    );
    a.q.push({ entries: [e('parts')], project: P(1) });
    await a.c.advance(1000);
    await flush();
    expect(srv.log).toEqual(['parts']);
    expect(a.events).toEqual(['grant']);
    expect(locks.held(draftLock)).toBe(true);
    expect(a.q.storageKey).toBe(queueKey(null, D));
    await unsentRect(srv, a);
    expect(commands(stored(storage, queueKey(D)))).toEqual(['theirs']);
    const mine = stored(storage, queueKey(null, D));
    expect(commands(mine)).toEqual(['rect']);
    expect(mine?.newId).toBe(D);
    // The other tab is gone: A takes the project key, its left queue is parked, A's moves there.
    letGo();
    await flush();
    expect(a.events).toEqual(['grant', 'moved']);
    expect(locks.held(draftLock)).toBe(false);
    expect(commands(parkedQueue(storage, D))).toEqual(['theirs']);
    expect(commands(stored(storage, queueKey(D)))).toEqual(['rect']);
    expect(stored(storage, queueKey(null, D))).toBeNull();
  });

  it('a saved project takes its draft queue only when the draft lock is free too', async () => {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = fakeServer();
    // Tab A is a draft of D; tab B has D open before A's create lands (it holds D's lock).
    const a = session(locks.api, storage, srv, { id: null, revision: 0, newId: D });
    await flush();
    const b = session(locks.api, storage, srv, { id: D, revision: 1 });
    await flush();
    expect(b.events).toEqual(['grant-no-draft']);
    // A creates D but cannot get the project key: its unsent "rect" stays under the draft key.
    a.q.push({ entries: [e('parts')], project: P(1) });
    await a.c.advance(1000);
    await unsentRect(srv, a);
    await flush();
    expect(a.events).toEqual(['grant']);
    expect(commands(stored(storage, queueKey(null, D)))).toEqual(['rect']);
    expect(b.q.pending).toEqual([]);
    expect(stored(storage, queueKey(D))).toBeNull();
    // A crashes, then B leaves: the next opener holds both locks and takes it once.
    a.leave();
    b.leave();
    await flush();
    const c = session(locks.api, storage, srv, { id: D, revision: srv.revision });
    await flush();
    expect(c.events).toEqual(['grant']);
    expect(c.q.pending.map((x) => x.command)).toEqual(['rect']);
    expect(stored(storage, queueKey(null, D))).toBeNull();
    await c.c.advance(1000);
    expect(srv.log).toEqual(['parts', 'rect']);
  });

  it('settle on a fresh project (T292 split-off): the lock moves with the created id', async () => {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = fakeServer();
    const a = session(locks.api, storage, srv, { id: null, revision: 0, newId: D });
    await flush();
    a.q.push({ entries: [e('parts')], project: P(1) });
    expect(await a.q.settle()).toBe(D);
    await flush();
    expect(locks.held(projectLock)).toBe(true);
    expect(locks.held(draftLock)).toBe(false);
    expect(a.q.storageKey).toBe(queueKey(D));
  });

  it('navigation to another project in the same tab lets the left project lock go', async () => {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = savedProject();
    const one = session(locks.api, storage, srv, { id: D, revision: 1 });
    await flush();
    expect(locks.held(projectLock)).toBe(true);
    one.leave();
    const two = session(locks.api, storage, srv, { id: 'p2', revision: 1 });
    await flush();
    expect(locks.held(projectLock)).toBe(false);
    expect(locks.held(queueLockName('p2'))).toBe(true);
    two.leave();
    const back = session(locks.api, storage, srv, { id: D, revision: 1 });
    await flush();
    expect(back.events).toEqual(['grant']);
  });

  it('a page left while waiting for the project key lets every lock go', async () => {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = fakeServer();
    const letGo = locks.holdElsewhere(projectLock);
    const a = session(locks.api, storage, srv, { id: null, revision: 0, newId: D });
    await flush();
    a.q.push({ entries: [e('parts')], project: P(1) });
    await a.c.advance(1000);
    await flush();
    a.leave();
    await flush();
    expect(locks.held(draftLock)).toBe(false);
    letGo();
    await flush();
    expect(locks.held(projectLock)).toBe(false);
  });

  it('without locks the queue moves to the project key at the create (age rule, T326)', async () => {
    const storage = memoryStorage();
    const srv = fakeServer();
    const a = page(storage, srv, { id: null, revision: 0, newId: D });
    a.q.push({ entries: [e('parts')], project: P(1) });
    expect(a.q.storageKey).toBe(queueKey(null, D));
    await a.c.advance(1000);
    expect(a.q.storageKey).toBe(queueKey(D));
    await unsentRect(srv, a);
    expect(commands(stored(storage, queueKey(D)))).toEqual(['rect']);
    expect(stored(storage, queueKey(null, D))).toBeNull();
  });
});

/**
 * B60 fix round 3: the takeover table (D-117). A page that holds the lock decides against the
 * server's revision and last save id read now, never against the revision it loaded.
 */
describe('B60 r3: takeover table', () => {
  const ID = 'p3';
  /** A queue a gone page left under the project key: base `base`, entries a, b; unit = a. */
  function left(storage: KeyValueStorage, base: number, extra: Partial<StoredQueue> = {}) {
    storage.setItem(
      queueKey(ID),
      JSON.stringify({
        baseRevision: base,
        entries: [e('a'), e('b')],
        name: 'Proje',
        unit: { saveId: 'u1', count: 1 },
        owner: 'gone',
        at: NOW,
        ...extra,
      }),
    );
  }
  const take = (
    storage: KeyValueStorage,
    server: { revision: number; lastSaveId?: string | null } | null,
    tab: { revision: number; busy?: boolean },
  ) =>
    takeOverQueue(storage, {
      id: ID,
      server,
      tab: { revision: tab.revision, busy: tab.busy ?? false },
      pageId: 'me',
    });
  const cmds = (q: StoredQueue | null | undefined) => q?.entries.map((x) => x.command);

  it('base = server, tab current → replay (taken off the store)', () => {
    const storage = memoryStorage();
    left(storage, 4);
    const t = take(storage, { revision: 4, lastSaveId: 'x' }, { revision: 4 });
    expect(t.action).toBe('replay');
    expect(t.action === 'replay' && cmds(t.queue)).toEqual(['a', 'b']);
    expect(storage.getItem(queueKey(ID))).toBeNull();
  });

  it('base = server, tab stale → reload first; the queue stays stored as it is', () => {
    const storage = memoryStorage();
    left(storage, 5);
    const before = storage.getItem(queueKey(ID));
    expect(take(storage, { revision: 5, lastSaveId: 'x' }, { revision: 4 }).action).toBe('reload');
    expect(storage.getItem(queueKey(ID))).toBe(before);
    expect(parkedQueue(storage, ID)).toBeNull();
    // After the reload the tab is current: replayed.
    expect(take(storage, { revision: 5, lastSaveId: 'x' }, { revision: 5 }).action).toBe('replay');
  });

  it('own save ahead (server = base + 1 by its unit), tab current → replay what came after', () => {
    const storage = memoryStorage();
    left(storage, 4);
    const t = take(storage, { revision: 5, lastSaveId: 'u1' }, { revision: 5 });
    expect(t.action === 'replay' && cmds(t.queue)).toEqual(['b']);
  });

  it('own save ahead, tab stale → reload first, then replay what came after', () => {
    const storage = memoryStorage();
    left(storage, 4);
    expect(take(storage, { revision: 5, lastSaveId: 'u1' }, { revision: 4 }).action).toBe('reload');
    const t = take(storage, { revision: 5, lastSaveId: 'u1' }, { revision: 5 });
    expect(t.action === 'replay' && cmds(t.queue)).toEqual(['b']);
  });

  for (const tab of [6, 4]) {
    it(`foreign ahead, tab ${tab === 6 ? 'current' : 'stale'} → parked, never replayed`, () => {
      const storage = memoryStorage();
      left(storage, 4);
      expect(take(storage, { revision: 6, lastSaveId: 'other' }, { revision: tab }).action).toBe(
        'parked',
      );
      expect(cmds(parkedQueue(storage, ID))).toEqual(['a', 'b']);
      expect(storage.getItem(queueKey(ID))).toBeNull();
    });
  }

  it('fits, but the tab has unsent edits or a save on the way → parked (never merged)', () => {
    const storage = memoryStorage();
    left(storage, 4);
    expect(take(storage, { revision: 4 }, { revision: 4, busy: true }).action).toBe('parked');
    expect(cmds(parkedQueue(storage, ID))).toEqual(['a', 'b']);
  });

  it('server not reachable → parked', () => {
    const storage = memoryStorage();
    left(storage, 4);
    expect(take(storage, null, { revision: 4 }).action).toBe('parked');
    expect(cmds(parkedQueue(storage, ID))).toEqual(['a', 'b']);
  });

  it('draft page (no project yet) → replay against revision 0', () => {
    const storage = memoryStorage();
    storage.setItem(
      queueKey(null, D),
      JSON.stringify({
        baseRevision: 0,
        entries: [e('a')],
        name: 'Proje',
        newId: D,
        owner: 'gone',
      }),
    );
    const t = takeOverQueue(storage, {
      id: null,
      newId: D,
      server: null,
      tab: { revision: 0, busy: false },
      pageId: 'me',
    });
    expect(t.action === 'replay' && cmds(t.queue)).toEqual(['a']);
  });

  describe('parked changes a gone page was applying ("Uygula")', () => {
    function applying(storage: KeyValueStorage, saveId?: string) {
      storage.setItem(
        leftKey(ID),
        JSON.stringify({
          baseRevision: 3,
          entries: [e('a')],
          name: 'Proje',
          closed: true,
          applying: { owner: 'gone', ...(saveId ? { saveId } : {}) },
        }),
      );
    }
    it('its queue (holding them) is replayed → the parked copy goes', () => {
      const storage = memoryStorage();
      applying(storage, 'u1');
      left(storage, 4);
      expect(take(storage, { revision: 4 }, { revision: 4 }).action).toBe('replay');
      expect(parkedQueue(storage, ID)).toBeNull();
    });
    it('its queue is parked again → it replaces them, nothing twice', () => {
      const storage = memoryStorage();
      applying(storage, 'u1');
      left(storage, 4);
      expect(take(storage, { revision: 6, lastSaveId: 'z' }, { revision: 6 }).action).toBe(
        'parked',
      );
      const p = parkedQueue(storage, ID);
      expect(cmds(p)).toEqual(['a', 'b']);
      expect(p?.applying).toBeUndefined();
    });
    it('no queue left and the server has the applying save → they go', () => {
      const storage = memoryStorage();
      applying(storage, 'u1');
      expect(take(storage, { revision: 4, lastSaveId: 'u1' }, { revision: 4 }).action).toBe('none');
      expect(parkedQueue(storage, ID)).toBeNull();
    });
    it('no queue left and the server does not have it → they stay parked, mark cleared', () => {
      const storage = memoryStorage();
      applying(storage, 'u1');
      take(storage, { revision: 4, lastSaveId: 'other' }, { revision: 4 });
      const p = parkedQueue(storage, ID);
      expect(cmds(p)).toEqual(['a']);
      expect(p?.applying).toBeUndefined();
    });
  });
});

describe('B60 r3: one draft identity per live tab (copied ?taslak=)', () => {
  function fakeLocks() {
    const holders = new Set<string>();
    const api: LockApi = {
      request(name, options, cb) {
        if (holders.has(name)) {
          if (options.ifAvailable) return Promise.resolve(cb(null));
          return new Promise(() => {});
        }
        holders.add(name);
        return Promise.resolve(cb({ name })).finally(() => holders.delete(name));
      },
    };
    return { api, held: (n: string) => holders.has(n) };
  }
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await settle();
  };

  function draftTab(locks: LockApi, storage: KeyValueStorage, srv: Server, renew: string) {
    const p = page(storage, srv, { id: null, revision: 0, newId: D });
    p.q.useLocks();
    const events: string[] = [];
    const holder = holdQueueLocks(
      locks,
      { id: null, newId: D },
      {
        onGrant: () => {
          events.push('grant');
          p.q.claim();
        },
        onWait: () => events.push('wait'),
        onMoved: () => p.q.adopt(),
        onError: () => events.push('error'),
        onDraftBusy: () => {
          if (storedQueue(storage, queueKey(null, D))?.closed) return null;
          return p.q.renewDraft(renew) ? renew : null;
        },
      },
    );
    p.q.setOnCreated((id) => holder.created(id));
    return { ...p, events, holder };
  }

  it('a live tab owns the draft: the second tab takes a new id and never writes under it', async () => {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = fakeServer();
    const a = draftTab(locks.api, storage, srv, 'unused');
    await flush();
    srv.fail = true;
    a.q.push({ entries: [e('kop')], project: P(1) });
    await a.c.advance(1000);
    srv.fail = false;
    const B = '0b0b0b0b-1b2c-4d5e-8f90-a1b2c3d4e5f6';
    const b = draftTab(locks.api, storage, srv, B);
    await flush();
    expect(b.events).toEqual(['grant']);
    expect(b.q.draftId).toBe(B);
    expect(locks.held(queueLockName(null, B))).toBe(true);
    b.q.push({ entries: [e('yeni')], project: P(1) });
    await b.c.advance(1000);
    // B created its own project; A's queue is still A's, under A's draft.
    expect(b.sent.at(-1)?.newId).toBe(B);
    const stored = JSON.parse(storage.getItem(queueKey(null, D)) ?? '{}') as StoredQueue;
    expect(stored.entries.map((x) => x.command)).toEqual(['kop']);
    expect(stored.owner).toBe(a.q.ownerId);
    expect(srv.log).toEqual(['yeni']);
    expect(a.sent.every((r) => r.newId === D)).toBe(true);
  });

  it('the draft page is being closed (reload of the same tab): wait for its lock, keep the id', async () => {
    const locks = fakeLocks();
    const storage = memoryStorage();
    const srv = fakeServer();
    const a = draftTab(locks.api, storage, srv, 'unused');
    await flush();
    srv.fail = true;
    a.q.push({ entries: [e('kop')], project: P(1) });
    await a.c.advance(1000);
    a.q.closing();
    const b = draftTab(locks.api, storage, srv, 'other');
    await flush();
    expect(b.events).toEqual(['wait']);
    expect(b.q.draftId).toBe(D);
  });
});

describe('B60 r3: a stale second tab takes a crashed queue after a reload (tester r3, test 1)', () => {
  it('A saved r+1 and crashed with one more edit; B (still on r) reloads, then replays once', async () => {
    const storage = memoryStorage();
    const srv = savedProject(); // rev 1 = "r"
    const a = page(storage, srv, { id: 'p1', revision: 1 });
    a.q.useLocks();
    a.q.claim();
    a.q.push({ entries: [e('six')], project: P(1) });
    await a.c.advance(1000);
    expect(srv.revision).toBe(2);
    srv.fail = true;
    a.q.push({ entries: [e('seven')], project: P(2) });
    await a.c.advance(1000);
    srv.fail = false;
    a.q.dispose(); // crash
    // B loaded at rev 1; the server says 2, and A's queue is based on 2.
    const server = { revision: srv.revision, lastSaveId: srv.lastSaveId };
    const stale = takeOverQueue(storage, {
      id: 'p1',
      server,
      tab: { revision: 1, busy: false },
      pageId: 'b',
    });
    expect(stale.action).toBe('reload');
    // The reloaded B is on rev 2: replays "seven" once.
    const b = page(storage, srv, { id: 'p1', revision: srv.revision });
    b.q.useLocks();
    const t = takeOverQueue(storage, {
      id: 'p1',
      server,
      tab: { revision: b.q.baseRevision, busy: b.q.busy },
      pageId: b.q.ownerId,
    });
    expect(t.action).toBe('replay');
    if (t.action === 'replay')
      b.q.restore({ entries: t.queue.entries, project: P(3), name: 'Proje' });
    b.q.claim();
    await b.c.advance(1000);
    expect(srv.log).toEqual(['six', 'seven']);
    expect(srv.revision).toBe(3);
    expect(parkedQueue(storage, 'p1')).toBeNull();
  });
});

describe('B60 F1: a tab without the lock (a peer) that dies is taken by the lock holder', () => {
  const live = (storage: KeyValueStorage, srv: Server) => {
    const a = page(storage, srv, { id: 'p1', revision: 1 });
    a.q.useLocks();
    a.q.claim();
    const b = page(storage, srv, { id: 'p1', revision: 1 });
    b.q.useLocks();
    return { a, b };
  };
  const cmds = (q: StoredQueue | null) => (q ? q.entries.map((x) => x.command) : null);

  it('a peer stores its unsent edit under a key of its own; the holder never removes it', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const { a, b } = live(storage, srv);
    b.q.markPageLive();
    srv.drop = true;
    b.q.push({ entries: [e('b1')], project: P(1) });
    await b.c.advance(1000);
    expect(srv.log).toEqual([]);
    const key = peerKey('p1', b.q.ownerId);
    expect(cmds(storedQueue(storage, key))).toEqual(['b1']);
    expect(storedQueue(storage, queueKey('p1'))).toBeNull();
    // The holder edits and saves: its own key comes and goes, the peer's stays.
    srv.drop = false;
    a.q.push({ entries: [e('a1')], project: P(2) });
    await a.c.advance(1000);
    expect(srv.log).toEqual(['a1']);
    expect(cmds(storedQueue(storage, key))).toEqual(['b1']);
    expect(peerQueueKeys([key, queueKey('p1'), peerKey('p2', 'x')], 'p1', a.q.ownerId)).toEqual([
      { key, pageId: b.q.ownerId },
    ]);
    expect(peerQueueKeys([key], 'p1', b.q.ownerId)).toEqual([]);
  });

  it('before its page lock is held a peer stores nothing (never mistaken for a gone one)', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const { b } = live(storage, srv);
    srv.drop = true;
    b.q.push({ entries: [e('b1')], project: P(1) });
    await b.c.advance(1000);
    expect(storedQueue(storage, peerKey('p1', b.q.ownerId))).toBeNull();
    b.q.markPageLive();
    expect(cmds(storedQueue(storage, peerKey('p1', b.q.ownerId)))).toEqual(['b1']);
  });

  it('the peer is gone: its edit is parked once (offered), never dropped or merged', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const { a, b } = live(storage, srv);
    b.q.markPageLive();
    srv.drop = true;
    b.q.push({ entries: [e('b1')], project: P(1) });
    await b.c.advance(1000);
    b.q.dispose(); // crash
    srv.drop = false;
    // The holder saved in between: the peer's base is behind, still parked whole.
    a.q.push({ entries: [e('a1')], project: P(2) });
    await a.c.advance(1000);
    const key = peerKey('p1', b.q.ownerId);
    expect(takePeerQueue(storage, key, 'p1', { revision: srv.revision, lastSaveId: srv.lastSaveId })).toBe(true);
    expect(cmds(parkedQueue(storage, 'p1'))).toEqual(['b1']);
    expect(storedQueue(storage, key)).toBeNull();
    // A second sweep finds nothing: parked exactly once.
    expect(takePeerQueue(storage, key, 'p1', null)).toBe(false);
    expect(cmds(parkedQueue(storage, 'p1'))).toEqual(['b1']);
    expect(srv.log).toEqual(['a1']);
  });

  it('a peer whose save reached the server (answer lost): only what came after is parked', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const { b } = live(storage, srv);
    b.q.markPageLive();
    srv.lose = true;
    b.q.push({ entries: [e('b1')], project: P(1) });
    await b.c.advance(1000);
    srv.lose = false;
    srv.drop = true;
    b.q.push({ entries: [e('b2')], project: P(2) });
    await b.c.advance(5000);
    b.q.dispose();
    expect(srv.log).toEqual(['b1']);
    const key = peerKey('p1', b.q.ownerId);
    takePeerQueue(storage, key, 'p1', { revision: srv.revision, lastSaveId: srv.lastSaveId });
    expect(cmds(parkedQueue(storage, 'p1'))).toEqual(['b2']);
  });

  it('server unreachable at the sweep: the whole peer queue is parked', () => {
    const storage = memoryStorage();
    const q: StoredQueue = { baseRevision: 1, entries: [e('b1')], name: 'Proje', owner: 'pb', at: NOW };
    storage.setItem(peerKey('p1', 'pb'), JSON.stringify(q));
    expect(takePeerQueue(storage, peerKey('p1', 'pb'), 'p1', null)).toBe(true);
    expect(cmds(parkedQueue(storage, 'p1'))).toEqual(['b1']);
  });

  it('a peer that gets the lock later moves its queue under the project key', async () => {
    const storage = memoryStorage();
    const srv = savedProject();
    const { b } = live(storage, srv);
    b.q.markPageLive();
    srv.drop = true;
    b.q.push({ entries: [e('b1')], project: P(1) });
    await b.c.advance(1000);
    b.q.claim();
    expect(storedQueue(storage, peerKey('p1', b.q.ownerId))).toBeNull();
    expect(cmds(storedQueue(storage, queueKey('p1')))).toEqual(['b1']);
    expect(b.q.holdsLock).toBe(true);
  });
});
