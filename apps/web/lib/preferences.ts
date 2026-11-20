// Per-browser appearance preferences (T183, spec §3.7): density, motion and the 3D simple mode.
// The theme lives in next-themes (`THEME_STORAGE_KEY`). Density and motion sit on <html>
// (`data-density="compact"`, `data-motion="reduce"`), set by an inline script before the first
// paint, so a reload shows the stored choice without a jump; CSS reads the attributes and React
// subscribes to changes. Stored in localStorage only (D-074): a preference of this screen, not
// of the company or the user account.

import { useSyncExternalStore } from 'react';

export const DENSITY_STORAGE_KEY = 'nittcam-density';
export const MOTION_STORAGE_KEY = 'nittcam-motion';
/** Same key as the 3D preview's own "Basit mod" button (T154), so both stay in step. */
export const SIMPLE_3D_STORAGE_KEY = 'nittcam-3d-simple';

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];
/** "system" follows the OS setting; "reduce" turns motion off even when the OS allows it. */
export const MOTION_CHOICES = ['system', 'reduce'] as const;
export type MotionChoice = (typeof MOTION_CHOICES)[number];

const EVENT = 'nittcam:preferences';
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** Anything but "compact" is the default comfortable density. */
export function parseDensity(stored: string | null | undefined): Density {
  return stored === 'compact' ? 'compact' : 'comfortable';
}

/** Anything but "reduce" follows the OS. */
export function parseMotion(stored: string | null | undefined): MotionChoice {
  return stored === 'reduce' ? 'reduce' : 'system';
}

/** The stored 3D simple mode ("1" = on). */
export function parseSimple3d(stored: string | null | undefined): boolean {
  return stored === '1';
}

/** Runs in <head> before paint: copies the stored density and motion onto <html>. */
export const PREFERENCES_INIT_SCRIPT = `(function(){try{var d=document.documentElement,s=window.localStorage;if(s.getItem(${JSON.stringify(DENSITY_STORAGE_KEY)})==='compact')d.setAttribute('data-density','compact');if(s.getItem(${JSON.stringify(MOTION_STORAGE_KEY)})==='reduce')d.setAttribute('data-motion','reduce');}catch(e){}})();`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts until the next reload
  }
}

function setRootAttr(name: string, value: string | null): void {
  const root = document.documentElement;
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

function notify(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function readDensity(): Density {
  return parseDensity(document.documentElement.getAttribute('data-density'));
}

export function setDensity(density: Density): void {
  write(DENSITY_STORAGE_KEY, density);
  setRootAttr('data-density', density === 'compact' ? 'compact' : null);
  notify();
}

export function readMotion(): MotionChoice {
  return parseMotion(document.documentElement.getAttribute('data-motion'));
}

export function setMotion(choice: MotionChoice): void {
  write(MOTION_STORAGE_KEY, choice);
  setRootAttr('data-motion', choice === 'reduce' ? 'reduce' : null);
  notify();
}

export function readSimple3d(): boolean {
  return parseSimple3d(read(SIMPLE_3D_STORAGE_KEY));
}

export function setSimple3d(on: boolean): void {
  write(SIMPLE_3D_STORAGE_KEY, on ? '1' : '0');
  notify();
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  const mq = window.matchMedia?.(REDUCE_QUERY);
  mq?.addEventListener('change', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
    mq?.removeEventListener('change', cb);
  };
}

/**
 * True when motion should be cut: the OS asks for it or the user chose "reduce" in Ayarlar →
 * Görünüm. Plain function for code outside React (canvas fade-in).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return readMotion() === 'reduce' || !!window.matchMedia?.(REDUCE_QUERY).matches;
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
