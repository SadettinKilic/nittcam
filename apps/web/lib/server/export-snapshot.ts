/**
 * Project snapshot of an export (T179, D-066): the saved project JSON, name and revision an export
 * was generated from, plus the options that change its bytes (label settings). Stored next to the
 * export's files as `exports/<id>/project.json` but never listed in `files`, so it is not a
 * download. Re-export from history regenerates from it; older revisions are kept nowhere else.
 */
import { parseProject } from '@nittcam/core';
import type { Storage } from '@nittcam/db';
import type { ExportSource } from './exports';
import { exportFolder } from './exports';

export const SNAPSHOT_NAME = 'project.json';

export interface ExportSnapshot {
  /** Format of this file. */
  v: 1;
  name: string;
  revision: number;
  data: ExportSource['data'];
  /** Label sheet settings as their query string (`etiket` documents only). */
  labels?: string;
}

export const snapshotKey = (exportId: string): string =>
  `${exportFolder(exportId)}/${SNAPSHOT_NAME}`;

export async function writeSnapshot(
  storage: Storage,
  exportId: string,
  source: ExportSource,
  labels?: string,
): Promise<void> {
  const snap: ExportSnapshot = {
    v: 1,
    name: source.name,
    revision: source.revision,
    data: source.data,
    ...(labels !== undefined ? { labels } : {}),
  };
  await storage.put(snapshotKey(exportId), JSON.stringify(snap));
}

/** The snapshot, or null when the export has none (stored before T179) or it is unreadable. */
export async function readSnapshot(
  storage: Storage,
  exportId: string,
): Promise<ExportSnapshot | null> {
  const bytes = await storage.get(snapshotKey(exportId));
  if (!bytes) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ExportSnapshot>;
    if (raw.v !== 1 || typeof raw.name !== 'string' || !Number.isInteger(raw.revision)) return null;
    const parsed = parseProject(raw.data);
    if (!parsed.ok) return null;
    return {
      v: 1,
      name: raw.name,
      revision: raw.revision as number,
      data: parsed.project,
      ...(typeof raw.labels === 'string' ? { labels: raw.labels } : {}),
    };
  } catch {
    return null;
  }
}
