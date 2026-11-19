import { useSyncExternalStore } from 'react';

/** Placer candidates done / total while a nesting run is in the worker (T163). */
export interface NestProgress {
  done: number;
  total: number;
}

/**
 * A tiny store for the nesting progress. Only the progress bar subscribes, so a progress message
 * re-renders the bar, not the whole Dizilim step with its canvas (T163: no long main-thread task
 * while the worker runs).
 */
export interface NestProgressStore {
  get: () => NestProgress | null;
  set: (p: NestProgress | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createNestProgressStore(): NestProgressStore {
  let value: NestProgress | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (p) => {
      value = p;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useNestProgress(store: NestProgressStore | null): NestProgress | null {
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.get ?? nothing, nothing);
}

const noopSubscribe = () => () => {};
const nothing = () => null;
