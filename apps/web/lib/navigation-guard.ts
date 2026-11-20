/**
 * In-app navigation guard (B3 follow-up to T107): a page with unsaved changes registers a guard;
 * programmatic navigation (command palette, shortcuts) asks it first. Links and browser Back are
 * handled by the page itself; this covers `router.push` from the shell.
 */

/** Returns true when it took over the navigation (e.g. opened a "leave?" dialog). */
export type NavigationGuard = (href: string) => boolean;

type NavigationListener = (href: string) => void;

let current: NavigationGuard | null = null;
const listeners = new Set<NavigationListener>();

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
  for (const listener of listeners) listener(href);
  go(href);
}

/**
 * Tells `listener` about every in-app navigation the shell starts (after the guard let it through).
 * The wizard uses it to keep its own address swaps off a navigation that is still in flight: a
 * `history.replaceState` then makes Next's router drop the pending navigation (B49).
 */
export function onNavigationStart(listener: NavigationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The in-app address a same-tab link click goes to (Next `<Link>`s and plain anchors), or null for
 * clicks that do not leave the current address (modifier keys, new tab, download, hash only,
 * another origin).
 */
export function leavingLinkHref(
  e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'>,
  here: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>,
): string | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const target = e.target as Element | null;
  const a = target?.closest?.('a[href]') ?? null;
  if (!a) return null;
  const linkTarget = a.getAttribute('target');
  if ((linkTarget && linkTarget !== '_self') || a.hasAttribute('download')) return null;
  const url = new URL(a.getAttribute('href') ?? '', here.href);
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url.pathname + url.search;
}
