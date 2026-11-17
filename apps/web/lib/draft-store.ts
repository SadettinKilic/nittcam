'use client';

import { parseProject, type Project } from '@nittcam/core';
import { useSyncExternalStore } from 'react';

/**
 * The in-memory draft project shared by the Oluştur steps (parts → simulation) until the wizard
 * (T023) saves real projects. Kept in a module variable (survives client-side navigation) and
 * mirrored to `sessionStorage` (survives a reload of the tab). Storage may be unavailable
 * (private mode, blocked site data): then only the module copy is used.
 */
const KEY = 'nittcam.draftProject.v1';

let current: Project | null = null;
let loaded = false;

function load(): Project | null {
  if (loaded) return current;
  loaded = true;
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (raw) {
      const parsed = parseProject(JSON.parse(raw) as unknown);
      if (parsed.ok) current = parsed.project;
    }
  } catch {
    // Unreadable or invalid: start empty.
  }
  return current;
}

/**
 * Stores the draft (the parts step calls this after every change, once it has hydrated from the
 * store). The stored value is read first, so the store is only ever marked loaded by `load`.
 */
export function saveDraft(project: Project): void {
  load();
  if (project === current) return;
  current = project;
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(project));
  } catch {
    // Quota or blocked storage: the module copy still serves client-side navigation.
  }
}

/** The stored draft, or null. Browser only; the server never has one. */
export function getDraft(): Project | null {
  return typeof window === 'undefined' ? null : load();
}

function subscribeNever(): () => void {
  return () => {};
}

/**
 * False on the server and during hydration, true afterwards. The parts step saves only after
 * hydration, so a first render without the stored draft can never overwrite it.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function subscribe(): () => void {
  // The draft changes only through `saveDraft` on the parts page itself; readers take a snapshot.
  return () => {};
}

/**
 * The stored draft as React state: null on the server and during hydration, the stored project
 * right after (so server and client render the same markup first).
 */
export function useStoredDraft(): Project | null {
  return useSyncExternalStore(subscribe, getDraft, () => null);
}
