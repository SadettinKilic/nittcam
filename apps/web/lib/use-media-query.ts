'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Live `matchMedia` result. During server rendering and hydration it returns `serverValue`
 * (desktop by default), then the real value, without a hydration mismatch.
 */
export function useMediaQuery(query: string, serverValue = true): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? serverValue,
    () => serverValue,
  );
}

/** Workspace breakpoint (T197/T198): three columns from 1024 px, canvas-first below. */
export const WORKSPACE_DESKTOP = '(min-width: 1024px)';

/**
 * Touch rule for canvases (T198): a one-finger drag on an un-zoomed canvas scrolls the page
 * (`touch-action: pan-y`); once zoomed in, every touch belongs to the canvas (`none`). Pinch is
 * always the canvas's (pan-y excludes the browser's pinch zoom).
 */
export function canvasTouchClass(zoomed: boolean): string {
  return zoomed ? 'touch-none' : 'touch-pan-y';
}

/** True when the view is zoomed in beyond the fit scale (1 % tolerance). */
export function isZoomedIn(scale: number, fitScale: number): boolean {
  return fitScale > 0 && scale > fitScale * 1.01;
}
