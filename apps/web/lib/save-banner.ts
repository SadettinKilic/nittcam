import type { SaveState } from './autosave';

/** What the save banner shows (T187, spec §8.2); null = no banner. */
export type SaveBannerKind = 'offline' | 'failed' | null;

/**
 * Whether saving is in trouble: a failed save stays "failing" through the retry that follows it
 * (state `saving`), so the banner does not blink on every attempt; a success or new edits clear it.
 */
export function nextFailing(state: SaveState, failing: boolean): boolean {
  if (state === 'error') return true;
  if (state === 'saving') return failing;
  return false;
}

/**
 * Offline with unsaved work → "offline"; a failing save → "failed". A conflict has its own
 * notice, and nothing unsaved means nothing to warn about.
 */
export function saveBannerKind(
  state: SaveState,
  online: boolean,
  dirty: boolean,
  failing: boolean,
): SaveBannerKind {
  if (state === 'conflict') return null;
  if (!online && (dirty || failing)) return 'offline';
  if (failing) return 'failed';
  return null;
}
