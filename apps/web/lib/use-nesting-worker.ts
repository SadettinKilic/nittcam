'use client';

import type { Project, RunNestingParams } from '@nittcam/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { NestingResponse } from './nesting-messages';
import {
  createNestingHost,
  type NestActivity,
  type NestingHost,
  NESTING_CANCELLED,
} from './nesting-host';

export { NESTING_CANCELLED };

export interface NestingWorker {
  /** Runs `runNesting` in the worker; resolves with its response (or `cancelled`). */
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
  /** The page-wide host (T384: run state shared by Dizilim, Simülasyon and Dışa aktar). */
  host: NestingHost;
}

let shared: NestingHost | null = null;

/** The page's nesting host, created on first use (browser only). */
export function nestingHost(): NestingHost {
  shared ??= createNestingHost(
    () => new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' }),
  );
  return shared;
}

/**
 * Runs nesting in a Web Worker (spec §8.2). T384: the worker belongs to the page, not to the
 * Dizilim step; unmounting the step keeps a busy run alive until its result is in, so the caller
 * still records it.
 */
export function useNestingWorker(): NestingWorker {
  useEffect(() => nestingHost().acquire(), []);
  return useMemo(() => {
    const host = nestingHost();
    return { run: host.run, cancel: host.cancel, host };
  }, []);
}

const subscribeActivity = (listener: () => void) => nestingHost().subscribe(listener);
const getActivity = () => nestingHost().activity();
const nothing = () => null;

/** T384: the nesting run in progress anywhere on the page, null when idle. */
export function useNestingActivity(): NestActivity | null {
  return useSyncExternalStore(subscribeActivity, getActivity, nothing);
}
