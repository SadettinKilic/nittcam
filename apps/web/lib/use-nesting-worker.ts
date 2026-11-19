'use client';

import type { Project, RunNestingParams } from '@nittcam/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NestingRequest, NestingResponse, NestingWorkerMessage } from './nesting-messages';

/** Error of a request that was cancelled with `cancel()` (T163). */
export const NESTING_CANCELLED = 'cancelled';

interface Pending {
  resolve: (r: NestingResponse) => void;
  onProgress: ((done: number, total: number) => void) | undefined;
}

export interface NestingWorker {
  /** Runs `runNesting` in the worker; resolves with its response (or `cancelled`/`terminated`). */
  run: (
    project: Project,
    params: RunNestingParams,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<NestingResponse>;
  /**
   * "İptal" (T163): terminates the worker so the placer stops at once; every pending request
   * resolves with `cancelled` and nothing is recorded. The next `run` starts a fresh worker.
   */
  cancel: () => void;
}

/**
 * Runs nesting in a Web Worker (spec §8.2). The worker is created on first use and terminated on
 * unmount or cancel. Progress messages go to the request's `onProgress`.
 */
export function useNestingWorker(): NestingWorker {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  const stop = useCallback((error: string) => {
    worker.current?.terminate();
    worker.current = null;
    for (const [id, p] of pending.current) p.resolve({ id, ok: false, error });
    pending.current.clear();
  }, []);

  useEffect(() => () => stop('terminated'), [stop]);

  const run = useCallback<NestingWorker['run']>((project, params, onProgress) => {
    if (!worker.current) {
      const w = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' });
      w.addEventListener('message', (e: MessageEvent<NestingWorkerMessage>) => {
        const p = pending.current.get(e.data.id);
        if (!p) return;
        if (e.data.kind === 'progress') {
          p.onProgress?.(e.data.done, e.data.total);
          return;
        }
        pending.current.delete(e.data.id);
        p.resolve(e.data);
      });
      w.addEventListener('error', (e) => {
        for (const [id, p] of pending.current) {
          p.resolve({ id, ok: false, error: e.message || 'worker error' });
        }
        pending.current.clear();
      });
      worker.current = w;
    }
    const id = nextId.current++;
    const request: NestingRequest = { id, project, params };
    return new Promise<NestingResponse>((resolve) => {
      pending.current.set(id, { resolve, onProgress });
      worker.current?.postMessage(request);
    });
  }, []);

  const cancel = useCallback(() => stop(NESTING_CANCELLED), [stop]);
  return useMemo(() => ({ run, cancel }), [run, cancel]);
}
