/**
 * Address (URL) writes of the client pages, outside Next's router (T399, T392).
 *
 * Next.js patches `history.pushState` / `replaceState`: a write whose state carries its own keys
 * (`__NA`, `_N`) passes through untouched, any other write also moves the router's own URL
 * (`ACTION_RESTORE`). The router writes its URL back into the address bar on every commit, so a
 * write that skipped it (e.g. `replaceState(history.state, …)`, whose state already has `__NA`)
 * is undone by the next commit that was still pending: the first save's address swap dropped a
 * `?gorunum=` set in the same moment, and `?profil=son` came back after its clean-up.
 *
 * Every write here therefore (1) starts from the address as it is at that moment, so changes made
 * meanwhile are kept, and (2) uses a state with only our own keys, so the router always learns it.
 */

/** History entries of wizard steps carry this marker (D-029, D-030). */
export const STEP_STATE = 'nittcamStep';

/** Keys Next.js keeps in a history state; a state with any of them bypasses its router sync. */
const NEXT_KEYS: ReadonlySet<string> = new Set([
  '__NA',
  '__N',
  '_N',
  '__PRIVATE_NEXTJS_INTERNALS_TREE',
]);

export interface AddressChange {
  /** New pathname; omitted keeps the current one. */
  path?: string;
  /** Query keys to set (a value) or remove (`null`); other keys stay as they are now. */
  query?: Readonly<Record<string, string | null>>;
}

/** The address after `change`, merged into the current one (`href`). Path + search only. */
export function nextAddress(href: string, change: AddressChange): string {
  const url = new URL(href);
  if (change.path !== undefined) url.pathname = change.path;
  for (const [key, value] of Object.entries(change.query ?? {})) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url.pathname + url.search;
}

/** Our own keys of a history state (Next's are dropped so its router sync runs). */
export function ownState(state: unknown): Record<string, unknown> {
  if (typeof state !== 'object' || state === null) return {};
  return Object.fromEntries(Object.entries(state).filter(([key]) => !NEXT_KEYS.has(key)));
}

export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/**
 * Writes the address: `change` merged into the current address, as a new entry (`push`) or in
 * place (`replace`). `state` defaults to the current entry's own keys (a step entry stays one).
 * Returns the written path + search.
 */
export function writeAddress(
  mode: 'push' | 'replace',
  change: AddressChange,
  state?: Record<string, unknown>,
  env: { history: HistoryLike; location: { href: string } } = window,
): string {
  const next = nextAddress(env.location.href, change);
  const data = ownState(state ?? env.history.state);
  if (mode === 'push') env.history.pushState(data, '', next);
  else env.history.replaceState(data, '', next);
  return next;
}
