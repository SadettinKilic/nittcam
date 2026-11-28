import type { NestingMode, Project, RunNestingParams } from '@nittcam/core';
import { createNestProgressStore, type NestProgressStore } from './nesting-progress';
import type { NestingRequest, NestingResponse, NestingWorkerMessage } from './nesting-messages';

/** Error of a request that was cancelled with `cancel()` (T163). */
export const NESTING_CANCELLED = 'cancelled';

/** The part of `Worker` the host uses (a fake in unit tests). */
export interface WorkerLike {
  postMessage: (message: NestingRequest) => void;
  terminate: () => void;
  addEventListener(type: 'message', fn: (e: MessageEvent<NestingWorkerMessage>) => void): void;
  addEventListener(type: 'error', fn: (e: ErrorEvent) => void): void;
}

interface Pending {
  resolve: (r: NestingResponse) => void;
  onProgress: ((done: number, total: number) => void) | undefined;
}

/** The run that is in the worker right now (T384: shown by Simülasyon / Dışa aktar too). */
export interface NestActivity {
  mode: NestingMode;
}

export interface NestingHost {
  run: (
    project: Project,
    params: RunNestingParams,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<NestingResponse>;
  /** Terminates the worker; every pending request resolves with `cancelled`. */
  cancel: () => void;
  /**
   * A component starts using the host; the returned release ends it. T384: the last release does
   * not drop a busy run: the worker lives until its pending requests are answered, then stops.
   */
  acquire: () => () => void;
  /** Marks a run as active (returns its token); `end` with a stale token is ignored. */
  begin: (mode: NestingMode) => number;
  end: (token: number) => void;
  activity: () => NestActivity | null;
  subscribe: (listener: () => void) => () => void;
  /** Progress of the active run, shared by every view that shows it. */
  progress: NestProgressStore;
}

/**
 * One nesting worker per page (spec §8.2), kept outside React so leaving Dizilim while a run is
 * busy does not drop the result (T384): the run finishes, the caller records it, then the idle
 * worker stops.
 */
export function createNestingHost(makeWorker: () => WorkerLike): NestingHost {
  let worker: WorkerLike | null = null;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let users = 0;
  let activity: { token: number; snapshot: NestActivity } | null = null;
  let nextToken = 1;
  const listeners = new Set<() => void>();
  const progress = createNestProgressStore();

  function emit() {
    for (const l of listeners) l();
  }

  function stop(error: string) {
    worker?.terminate();
    worker = null;
    const all = [...pending];
    pending.clear();
    for (const [id, p] of all) p.resolve({ id, ok: false, error });
  }

  function stopIfIdle() {
    if (users === 0 && pending.size === 0 && worker) {
      worker.terminate();
      worker = null;
    }
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    const w = makeWorker();
    w.addEventListener('message', (e: MessageEvent<NestingWorkerMessage>) => {
      // T379: a worker stopped by cancel may still report; its requests are gone then.
      if (worker !== w) return;
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.kind === 'progress') {
        p.onProgress?.(e.data.done, e.data.total);
        return;
      }
      pending.delete(e.data.id);
      p.resolve(e.data);
      stopIfIdle();
    });
    w.addEventListener('error', (e: ErrorEvent) => {
      if (worker !== w) return;
      stop(e.message || 'worker error');
    });
    worker = w;
    return w;
  }

  return {
    run(project, params, onProgress) {
      const w = ensureWorker();
      const id = nextId++;
      return new Promise<NestingResponse>((resolve) => {
        pending.set(id, { resolve, onProgress });
        w.postMessage({ id, project, params });
      });
    },
    cancel: () => stop(NESTING_CANCELLED),
    acquire() {
      users++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        users--;
        stopIfIdle();
      };
    },
    begin(mode) {
      const token = nextToken++;
      activity = { token, snapshot: { mode } };
      emit();
      return token;
    },
    end(token) {
      if (activity?.token !== token) return;
      activity = null;
      progress.set(null);
      emit();
    },
    activity: () => activity?.snapshot ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    progress,
  };
}
