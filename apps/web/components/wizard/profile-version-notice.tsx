'use client';

import { fill } from '../../lib/draft-project';
import { focusRing } from '../page/page-header';

export { versionGap } from '../../lib/profile-version';

/**
 * T269: "Makine profili güncellendi … [Son sürüme geç]". Step 1, Simülasyon and Dışa aktar show
 * the same box when the machine has a newer profile version than the project; the button moves
 * the project to it with one `setMachine` (one undo step). Preview and file both use the
 * project's version until then.
 */
export function ProfileVersionNotice({
  t,
  machineId,
  version,
  latest,
  run,
}: {
  t: { profileNewer: string; useLatest: string };
  machineId: string;
  /** The project's profile version. */
  version: number;
  /** The machine's latest version (from `versionGap`). */
  latest: number;
  run: (name: string, params: unknown) => boolean;
}) {
  return (
    <div
      data-testid="profile-version-notice"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-xs text-info-text"
    >
      <span>{fill(t.profileNewer, { old: version, latest })}</span>
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
