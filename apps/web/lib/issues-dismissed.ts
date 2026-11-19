/**
 * The cut list's floating Uyarılar panel (T256): once the user closes it, it stays closed for that
 * project (across reloads) until an issue type appears that was not there when it was closed.
 * Stored per project in localStorage as the list of issue codes present at closing. Storage may
 * be unavailable (private mode, quota): then nothing is remembered and nothing breaks.
 */

const PREFIX = 'nittcam-issues-closed:';

/** Issue codes present when the panel was closed for `projectId`, or null when never closed. */
export function readDismissed(projectId: string | undefined): string[] | null {
  if (!projectId) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + projectId);
    if (raw === null) return null;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** Remembers that the panel was closed with these issue codes present. */
export function writeDismissed(projectId: string | undefined, codes: readonly string[]): void {
  if (!projectId) return;
  try {
    window.localStorage.setItem(PREFIX + projectId, JSON.stringify([...new Set(codes)].sort()));
  } catch {
    // Not remembered; the panel just opens again next time.
  }
}

/**
 * May the panel open by itself? Only when it fits beside the grid without covering cells, and
 * not after the user closed it, unless a new issue type has appeared since.
 */
export function mayAutoOpen(
  fits: boolean,
  codes: readonly string[],
  dismissed: readonly string[] | null,
): boolean {
  if (!fits || codes.length === 0) return false;
  if (dismissed === null) return true;
  const seen = new Set(dismissed);
  return codes.some((c) => !seen.has(c));
}
