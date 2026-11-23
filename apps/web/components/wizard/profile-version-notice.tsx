'use client';

import { fill } from '../../lib/fill';
import { focusRing } from '../page/page-header';

export { versionGap } from '../../lib/profile-version';

/**
 * T269, T332 (field rehearsal S2): "Makine profili güncellendi … [Güncel makine sürümüne geç]", a
 * warning (not a note): the file uses the old version's tools and limits until the switch. Step 1, Simülasyon and Dışa aktar show
 * the same box when the machine has a newer profile version than the project; the button moves
 * the project to it with one `setMachine` (one undo step). Preview and file both use the
 * project's version until then.
 */
export function ProfileVersionNotice({
  t,
  machineId,
  version,
  latest,
  changes,
  run,
}: {
  t: { profileNewer: string; profileNewerChanges: string; useLatest: string };
  machineId: string;
  /** T332: what the newer version changed ("takımlar, post"); absent = not known here. */
  changes?: string | undefined;
  /** The project's profile version. */
  version: number;
  /** The machine's latest version (from `versionGap`). */
  latest: number;
  run: (name: string, params: unknown) => boolean;
}) {
  return (
    <div
      data-testid="profile-version-notice"
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning-text"
    >
      <span>
        {changes
          ? fill(t.profileNewerChanges, { old: version, latest, changes })
          : fill(t.profileNewer, { old: version, latest })}
      </span>
      <button
        type="button"
        data-testid="profile-use-latest"
        className={`h-control-sm rounded-md border border-border-strong bg-surface px-2.5 font-medium text-fg shadow-xs hover:bg-surface-hover ${focusRing}`}
        onClick={() => run('setMachine', { machineId, profileVersion: latest })}
      >
        {t.useLatest}
      </button>
    </div>
  );
}
