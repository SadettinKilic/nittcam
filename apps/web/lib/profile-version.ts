/**
 * T269: the machine's latest profile version when it is newer than (differs from) the version
 * the project is bound to; `null` when there is no gap or the latest is not the project's machine.
 */
export function versionGap(
  pinned: { machineId: string; profileVersion: number },
  latest: { id: string; version: number } | null,
): number | null {
  return latest && latest.id === pinned.machineId && latest.version !== pinned.profileVersion
    ? latest.version
    : null;
}
