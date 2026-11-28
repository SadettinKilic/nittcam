import type { Project, RunNestingParams } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import type { NestingRequest, NestingWorkerMessage } from './nesting-messages';
import { createNestingHost, NESTING_CANCELLED, type WorkerLike } from './nesting-host';

class FakeWorker implements WorkerLike {
  posted: NestingRequest[] = [];
  terminated = false;
  private onMessage: ((e: MessageEvent<NestingWorkerMessage>) => void) | null = null;
  postMessage(m: NestingRequest) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  addEventListener(type: 'message' | 'error', fn: (e: never) => void) {
    if (type === 'message') this.onMessage = fn as (e: MessageEvent<NestingWorkerMessage>) => void;
  }
  reply(data: NestingWorkerMessage) {
    this.onMessage?.({ data } as MessageEvent<NestingWorkerMessage>);
  }
}

const project = {} as Project;
const params = { toolDiameter: 6 } as RunNestingParams;

function setup() {
  const workers: FakeWorker[] = [];
  const host = createNestingHost(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { host, workers };
}

describe('nesting host (T384)', () => {
  it('keeps a busy run alive after the last user leaves and stops the worker once answered', async () => {
    const { host, workers } = setup();
    const release = host.acquire();
    const seen: number[] = [];
    const result = host.run(project, params, (done) => seen.push(done));
    release(); // the user left Dizilim while the run is busy
    const w = workers[0]!;
    expect(w.terminated).toBe(false);
    w.reply({ id: 1, kind: 'progress', done: 3, total: 9 });
    w.reply({ id: 1, ok: false, error: 'boom' });
    await expect(result).resolves.toEqual({ id: 1, ok: false, error: 'boom' });
    expect(seen).toEqual([3]);
    expect(w.terminated).toBe(true);
  });

  it('keeps the idle worker while a user holds it; a new run after release starts a fresh one', async () => {
    const { host, workers } = setup();
    const release = host.acquire();
    const first = host.run(project, params);
    workers[0]!.reply({ id: 1, ok: false, error: 'x' });
    await first;
    expect(workers[0]!.terminated).toBe(false);
    release();
    expect(workers[0]!.terminated).toBe(true);
    void host.run(project, params);
    expect(workers).toHaveLength(2);
  });

  it('cancel answers every pending run with cancelled and ignores the old worker', async () => {
    const { host, workers } = setup();
    const a = host.run(project, params);
    host.cancel();
    await expect(a).resolves.toMatchObject({ ok: false, error: NESTING_CANCELLED });
    workers[0]!.reply({ id: 1, ok: false, error: 'late' }); // ignored
    expect(workers[0]!.terminated).toBe(true);
  });

  it('activity: only the latest token ends it; the snapshot is stable for subscribers', () => {
    const { host } = setup();
    let calls = 0;
    const off = host.subscribe(() => calls++);
    const t1 = host.begin('minWaste');
    const snap = host.activity();
    expect(snap).toEqual({ mode: 'minWaste' });
    expect(host.activity()).toBe(snap);
    const t2 = host.begin('fastest');
    host.end(t1); // stale: a cancelled run finishing after its successor started
    expect(host.activity()).toEqual({ mode: 'fastest' });
    host.progress.set({ done: 1, total: 2 });
    host.end(t2);
    expect(host.activity()).toBeNull();
    expect(host.progress.get()).toBeNull();
    off();
    expect(calls).toBe(3);
  });
});
