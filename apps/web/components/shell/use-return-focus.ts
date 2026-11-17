import { useCallback, useRef } from 'react';

/**
 * Focus return for overlays opened from state instead of a Radix Trigger (T103).
 * Radix only refocuses its own Trigger on close; without one focus falls to <body>.
 * Call `remember()` right before opening; pass `onCloseAutoFocus` to the content.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);

  const remember = useCallback(() => {
    const el = document.activeElement;
    opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
  }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    const el = opener.current;
    opener.current = null;
    if (!el || !el.isConnected) return;
    event.preventDefault();
    el.focus();
  }, []);

  return { remember, onCloseAutoFocus };
}
