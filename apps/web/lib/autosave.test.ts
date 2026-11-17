import type { CommandLogEntry, Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  AutosaveQueue,
  defaultRetryMs,
  queueKey,
  takeUnsentQueue,
  type KeyValueStorage,
  type SaveRequest,
  type SaveState,
  type SendResult,
} from './autosave';

const AT = '2026-11-17T10:00:00.000+03:00';
const e = (command: string): CommandLogEntry => ({ command, params: {}, actor: 'user', at: AT });
const P = (n: number) => ({ n }) as unknown as Project;

/** A manual clock: timers fire only when the test advances time. */
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
    get pending() {
      return timers.size;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function setup(
  respond: (req: SaveRequest, n: number) => SendResult | Promise<SendResult>,
  init: { id: string | null; revision: number } = { id: 'p1', revision: 1 },
) {
  const c = clock();
  const storage = memoryStorage();
  const sent: SaveRequest[] = [];
  const states: SaveState[] = [];
  const created: string[] = [];
  const q = new AutosaveQueue(
    {
      send: async (req) => {
        sent.push({ ...req, commands: [...req.commands] });
        return respond(req, sent.length);
      },
      storage,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      onState: (s) => states.push(s),
      onCreated: (id) => created.push(id),
    },
    { ...init, name: 'Proje', project: P(0) },
  );
  return { q, c, storage, sent, states, created };
}

const okRev = (req: SaveRequest): SendResult => ({
  ok: true,
  id: req.id ?? 'created',
  revision: req.baseRevision + 1,
});

describe('AutosaveQueue: debounce', () => {
  it('saves once, 1 s after the last change, with every pending command', async () => {
    const { q, c, sent, states } = setup(okRev);
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(600);
    q.push({ entries: [e('b')], project: P(2) });
    await c.advance(600);
    expect(sent).toHaveLength(0);
    expect(q.state).toBe('pending');
    await c.advance(400);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 'p1', baseRevision: 1, project: P(2), name: 'Proje' });
    expect(sent[0]?.commands.map((x) => x.command)).toEqual(['a', 'b']);
    expect(q.state).toBe('saved');
    expect(q.baseRevision).toBe(2);
    expect(q.pending).toEqual([]);
    expect(states).toEqual(['pending', 'saving', 'saved']);
  });

  it('flush skips the debounce; nothing to save sends nothing', async () => {
    const { q, sent } = setup(okRev);
    await q.flush();
    expect(sent).toHaveLength(0);
    q.push({ entries: [e('a')], project: P(1) });
    await q.flush();
    expect(sent).toHaveLength(1);
  });

  it('a rename alone is saved too', async () => {
    const { q, c, sent } = setup(okRev);
    q.push({ name: 'Mutfak' });
    await c.advance(1000);
    expect(sent[0]).toMatchObject({ name: 'Mutfak', commands: [] });
  });

  it('changes made while a save runs go out in the next save on the new revision', async () => {
    const gate = { release: () => {} };
    const { q, c, sent } = setup(async (req, n) => {
      if (n === 1) await new Promise<void>((r) => (gate.release = r));
      return okRev(req);
    });
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    expect(q.state).toBe('saving');
    q.push({ entries: [e('b')], project: P(2) });
    gate.release();
    await settle();
    expect(q.state).toBe('pending');
    expect(q.pending.map((x) => x.command)).toEqual(['b']);
    await c.advance(1000);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ baseRevision: 2, project: P(2) });
    expect(sent[1]?.commands.map((x) => x.command)).toEqual(['b']);
    expect(q.state).toBe('saved');
  });
});

describe('AutosaveQueue: retry', () => {
  it('retries a network error with backoff and keeps the commands', async () => {
    const { q, c, sent, states } = setup((req, n) =>
      n < 3 ? { ok: false, kind: n === 1 ? 'network' : 'server' } : okRev(req),
    );
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    expect(q.state).toBe('error');
    expect(q.pending).toHaveLength(1);
    await c.advance(defaultRetryMs(1));
    expect(sent).toHaveLength(2);
    await c.advance(defaultRetryMs(2) - 1);
    expect(sent).toHaveLength(2);
    await c.advance(1);
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => s.baseRevision === 1)).toBe(true);
    expect(q.state).toBe('saved');
    expect(states).toEqual(['pending', 'saving', 'error', 'saving', 'error', 'saving', 'saved']);
  });

  it('a thrown transport error counts as a network error', async () => {
    const { q, c } = setup(() => {
      throw new Error('offline');
    });
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    expect(q.state).toBe('error');
    expect(c.pending).toBe(1);
  });

  it('an invalid request is not retried by itself', async () => {
    const { q, c } = setup(() => ({ ok: false, kind: 'invalid' }));
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    expect(q.state).toBe('error');
    expect(c.pending).toBe(0);
  });

  it('backoff grows to 30 s', () => {
    expect([1, 2, 3, 6, 10].map(defaultRetryMs)).toEqual([1000, 2000, 4000, 30000, 30000]);
  });
});

describe('AutosaveQueue: conflict', () => {
  it('409 stops autosave; later changes are queued but not sent', async () => {
    const { q, c, sent, storage } = setup(() => ({ ok: false, kind: 'conflict' }));
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    expect(q.state).toBe('conflict');
    q.push({ entries: [e('b')], project: P(2) });
    await c.advance(60_000);
    expect(sent).toHaveLength(1);
    expect(q.state).toBe('conflict');
    expect(storage.data.has(queueKey('p1'))).toBe(true);
    q.discard();
    expect(q.state).toBe('idle');
    expect(storage.data.has(queueKey('p1'))).toBe(false);
  });
});

describe('AutosaveQueue: unsent queue in sessionStorage (§8.2)', () => {
  it('mirrors the unsent commands with their base revision and clears them after the save', async () => {
    const { q, c, storage } = setup(okRev);
    q.push({ entries: [e('a')], project: P(1) });
    const stored = JSON.parse(storage.data.get(queueKey('p1')) ?? '{}');
    expect(stored).toMatchObject({ baseRevision: 1, name: 'Proje' });
    expect(stored.entries).toHaveLength(1);
    await c.advance(1000);
    expect(storage.data.has(queueKey('p1'))).toBe(false);
  });

  it('a reload replays the queue only when the server is still on its base revision', () => {
    const storage = memoryStorage();
    const queue = { baseRevision: 3, entries: [e('a')], name: 'X' };
    storage.setItem(queueKey('p1'), JSON.stringify(queue));
    expect(takeUnsentQueue(storage, 'p1', 3)).toEqual(queue);
    // The save went through before the reload: the server is ahead, the queue is dropped.
    expect(takeUnsentQueue(storage, 'p1', 4)).toBeNull();
    expect(storage.data.size).toBe(0);
    storage.setItem(queueKey('p1'), '{broken');
    expect(takeUnsentQueue(storage, 'p1', 3)).toBeNull();
    expect(takeUnsentQueue(null, 'p1', 3)).toBeNull();
  });

  it('a new project is created by its first save and its queue moves to the new id', async () => {
    const { q, c, sent, storage, created } = setup(
      (req) => ({ ok: true, id: 'new-id', revision: req.id === null ? 1 : req.baseRevision + 1 }),
      { id: null, revision: 0 },
    );
    q.push({ entries: [e('a')], project: P(1) });
    expect(storage.data.has(queueKey(null))).toBe(true);
    await c.advance(1000);
    expect(sent[0]).toMatchObject({ id: null, baseRevision: 0 });
    expect(created).toEqual(['new-id']);
    expect(q.projectId).toBe('new-id');
    expect(q.baseRevision).toBe(1);
    expect(storage.data.size).toBe(0);
    q.push({ entries: [e('b')], project: P(2) });
    expect(storage.data.has(queueKey('new-id'))).toBe(true);
    await c.advance(1000);
    expect(sent[1]).toMatchObject({ id: 'new-id', baseRevision: 1 });
  });

  it('works without storage (blocked site data)', async () => {
    const c = clock();
    const sent: SaveRequest[] = [];
    const q = new AutosaveQueue(
      {
        send: async (req) => {
          sent.push(req);
          return okRev(req);
        },
        storage: {
          getItem: () => {
            throw new Error('blocked');
          },
          setItem: () => {
            throw new Error('blocked');
          },
          removeItem: () => {
            throw new Error('blocked');
          },
        },
        setTimer: c.setTimer,
        clearTimer: c.clearTimer,
      },
      { id: 'p1', revision: 1, name: 'P', project: P(0) },
    );
    q.push({ entries: [e('a')], project: P(1) });
    await c.advance(1000);
    expect(sent).toHaveLength(1);
    expect(q.state).toBe('saved');
  });
});
