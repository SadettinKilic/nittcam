/**
 * In-app navigation guard (B3 follow-up to T107): a page with unsaved changes registers a guard;
 * programmatic navigation (command palette, shortcuts) asks it first. Links and browser Back are
 * handled by the page itself; this covers `router.push` from the shell.
 */

/** Returns true when it took over the navigation (e.g. opened a "leave?" dialog). */
export type NavigationGuard = (href: string) => boolean;

let current: NavigationGuard | null = null;

/** Registers the guard; the returned function removes it (only if it is still the active one). */
export function setNavigationGuard(guard: NavigationGuard): () => void {
  current = guard;
  return () => {
    if (current === guard) current = null;
  };
}

/** Navigates with `go` unless the active guard takes the navigation over. */
export function guardedNavigate(href: string, go: (href: string) => void): void {
  if (current?.(href)) return;
  go(href);
}
