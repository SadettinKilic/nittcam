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
  leftDrafts,
  STALE_MS,
  takeUnsentQueue,
  type KeyValueStorage,
  type SaveRequest,
  type SendResult,
  type StoredQueue,
} from './autosave';

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
});
