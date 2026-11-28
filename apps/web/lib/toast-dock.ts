'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * T394 (CTO #14 M2): in the workspace views (Çizim, Montaj, Dizilim, Simülasyon) toasts sit at the
 * bottom-right of the canvas, above every canvas toolbar marked `data-toast-avoid` that lies in
 * the toast column, so a toast (and its "Geri al") never lands on a tool. The canvas publishes
 * its offsets as CSS variables (`--toast-dock-right`, `--toast-dock-bottom`); the AppShell's
 * Toaster switches to bottom-right while a dock is mounted. Supersedes the B-M2 / B67 top offsets.
 */

/** Sonner's toast width (px) plus a little room: the column a toast occupies. */
export const TOAST_COLUMN = 372;
/** Gap between the toast and the canvas edge or a toolbar (px). */
export const TOAST_GAP = 12;

export interface DockRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Offsets of a bottom-right toast inside `canvas` (viewport px): `right` from the viewport's right
 * edge, `bottom` from its bottom edge, above every `avoid` rect that reaches into the toast column
 * in the canvas's lower half. Pure, so it is unit-tested.
 */
export function dockOffsets(
  canvas: DockRect,
  avoid: readonly DockRect[],
  viewport: { width: number; height: number },
): { right: number; bottom: number } {
  const colRight = canvas.right - TOAST_GAP;
  const colLeft = colRight - TOAST_COLUMN;
  const mid = (canvas.top + canvas.bottom) / 2;
  let line = canvas.bottom - TOAST_GAP;
  for (const r of avoid) {
    if (r.right <= r.left || r.bottom <= r.top) continue; // hidden
    if (r.right <= colLeft || r.left >= colRight) continue; // beside the column
    if (r.bottom <= mid) continue; // a top toolbar: the toast is below it anyway
    line = Math.min(line, r.top - TOAST_GAP / 2);
  }
  return {
    right: Math.max(0, Math.round(viewport.width - colRight)),
    bottom: Math.max(0, Math.round(viewport.height - line)),
  };
}

let docks = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const emit = () => {
  for (const l of listeners) l();
};

/** True while a workspace canvas holds the toast dock (the Toaster goes bottom-right). */
export function useToastDocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => docks > 0,
    () => false,
  );
}

/** Holds the toast dock for the canvas element `el` while it is mounted. */
export function useToastDock(el: HTMLElement | null): void {
  useEffect(() => {
    if (!el) return;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const avoid = [...el.querySelectorAll<HTMLElement>('[data-toast-avoid]')].map((a) =>
          a.getBoundingClientRect(),
        );
        const o = dockOffsets(rect, avoid, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        root.style.setProperty('--toast-dock-right', `${o.right}px`);
        root.style.setProperty('--toast-dock-bottom', `${o.bottom}px`);
      });
    };
    docks += 1;
    emit();
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Toolbars come and go (typed input, tool options): re-measure on DOM changes in the canvas.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      docks -= 1;
      emit();
      if (docks === 0) {
        root.style.removeProperty('--toast-dock-right');
        root.style.removeProperty('--toast-dock-bottom');
      }
    };
  }, [el]);
}
