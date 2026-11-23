'use client';

import { useEffect, type RefObject } from 'react';

/** CSS variable the shell's default Toaster keeps its bottom offset at (B49). */
export const PAGE_BAR_CLEAR_VAR = '--page-bar-clear';

/** Space a toast leaves below itself above a sticky bar `height` px tall, `bottom` px from the edge. */
export function pageBarClearance(height: number, bottom: number): string {
  return `${Math.ceil(height + bottom + 8)}px`;
}

/**
 * B49: a page with a sticky bottom action bar (the machine form's save bar) publishes how much room
 * it takes, so toasts stack above it instead of covering its buttons (a hovered toast never closes,
 * so a covered "Kaydet" stayed covered).
 */
export function usePageBarClearance(ref: RefObject<HTMLElement | null>, bottom: number): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => {
      root.style.setProperty(
        PAGE_BAR_CLEAR_VAR,
        pageBarClearance(el.getBoundingClientRect().height, bottom),
      );
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(PAGE_BAR_CLEAR_VAR);
    };
  }, [ref, bottom]);
}
