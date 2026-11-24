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

/** What a newer machine profile version changed, in the order the operator should check it. */
export type ProfileChange = 'tools' | 'limits' | 'post' | 'origin' | 'toolChanger' | 'materials';

export const PROFILE_CHANGES: readonly ProfileChange[] = [
  'tools',
  'limits',
  'post',
  'origin',
  'toolChanger',
  'materials',
];

/** Profile fields behind each change group (`limits` = travel, table, spindle, feeds, Z). */
const CHANGE_FIELDS: Record<ProfileChange, readonly string[]> = {
  tools: ['tools'],
  limits: [
    'workEnvelope',
    'table',
    'safeZ',
    'zZero',
    'rapidFeed',
    'maxFeed',
    'maxPlungeFeed',
    'spindle',
    'constraints',
    'holdDown',
  ],
  post: ['post'],
  origin: ['origin'],
  toolChanger: ['toolChanger'],
  materials: ['materials'],
};

/**
 * T332 (field rehearsal S2): the groups that differ between the project's profile version and the
 * machine's newest one, so the warning and the checklist line can say what the file would miss.
 * Identity, notes and the example flag do not count.
 */
export function profileChanges(
  pinned: Record<string, unknown>,
  latest: Record<string, unknown>,
): ProfileChange[] {
  const same = (k: string) => JSON.stringify(pinned[k]) === JSON.stringify(latest[k]);
  return PROFILE_CHANGES.filter((g) => !CHANGE_FIELDS[g].every(same));
}
