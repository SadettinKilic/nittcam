'use client';

// React side of the appearance preferences (T183): kept apart from lib/preferences.ts so the
// root layout (a server component) can import the init script without React client hooks.

import { useSyncExternalStore } from 'react';
import {
  PREFERENCES_EVENT,
  REDUCE_QUERY,
  prefersReducedMotion,
  readDensity,
  readMotion,
  readSimple3d,
  type Density,
  type MotionChoice,
} from './preferences';

function subscribe(cb: () => void): () => void {
  window.addEventListener(PREFERENCES_EVENT, cb);
  window.addEventListener('storage', cb);
  const mq = window.matchMedia?.(REDUCE_QUERY);
  mq?.addEventListener('change', cb);
  return () => {
    window.removeEventListener(PREFERENCES_EVENT, cb);
    window.removeEventListener('storage', cb);
    mq?.removeEventListener('change', cb);
  };
}

/** `prefersReducedMotion()` as React state (false on the server and during hydration). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/** The stored choices as React state; the server snapshot is the default. */
export function useDensity(): Density {
  return useSyncExternalStore(subscribe, readDensity, () => 'comfortable');
}

export function useMotionChoice(): MotionChoice {
  return useSyncExternalStore(subscribe, readMotion, () => 'system');
}

export function useSimple3d(): boolean {
  return useSyncExternalStore(subscribe, readSimple3d, () => false);
}
