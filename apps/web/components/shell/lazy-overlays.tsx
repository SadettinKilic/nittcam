'use client';

import dynamic from 'next/dynamic';

/**
 * T385 (D-134): the shell's overlays (Ctrl/⌘+K palette with cmdk, the shortcuts sheet, "Yenilikler")
 * open only on demand, so they load after the page instead of with every route's first JavaScript.
 * `preloadShellOverlays` fetches them once the page has loaded: a user who goes offline right after
 * opening a page can still open them (D-117), and the first open stays instant.
 */
const loadCommandMenu = () => import('./command-menu');
const loadShortcutsDialog = () => import('./shortcuts-dialog');
const loadWhatsNewDialog = () => import('./whats-new-dialog');

export const CommandMenu = dynamic(() => loadCommandMenu().then((m) => m.CommandMenu), {
  ssr: false,
});
export const ShortcutsDialog = dynamic(() => loadShortcutsDialog().then((m) => m.ShortcutsDialog), {
  ssr: false,
});
export const WhatsNewDialog = dynamic(() => loadWhatsNewDialog().then((m) => m.WhatsNewDialog), {
  ssr: false,
});

let preloaded = false;

/** Fetches the overlay chunks after the page's `load` event (once per page life). */
export function preloadShellOverlays(): void {
  if (preloaded || typeof window === 'undefined') return;
  preloaded = true;
  const run = () => {
    for (const load of [loadCommandMenu, loadShortcutsDialog, loadWhatsNewDialog]) {
      void load().catch(() => undefined);
    }
  };
  const later = () => window.setTimeout(run, 500);
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}
