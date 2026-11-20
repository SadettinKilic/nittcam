/**
 * Storing an NC export run (T021, D-030; shared by the export step and re-export from history,
 * T179): files, the export record and the project snapshot (D-066). Same key = the existing record.
 * A stored NC export moves the project from "taslak" to "üretildi" (spec §3.4).
 */
import type { CompanyScope, ExportRow } from '@nittcam/db';
import { companyStorage, defaultUser } from './company';
import { writeSnapshot } from './export-snapshot';
import {
  exportFolder,
  fileBytes,
  fileInfos,
  manifestHash,
  newExportId,
  storedStage,
  type ExportRun,
} from './exports';

export interface StoredNc {
  row: ExportRow;
  created: boolean;
  profileVersion: number;
}

/** Stores a run that passed (`run.ok`, machine and post set); the caller checked the acceptance. */
export async function storeNcRun(scope: CompanyScope, run: ExportRun): Promise<StoredNc> {
  const machine = run.machine;
  const post = run.post;
  if (!run.ok || !machine || !post) throw new Error('storeNcRun needs a passing run');
  const project = run.project;
  const infos = fileInfos(run.files);
  const key = {
    projectId: project.id,
    projectRevision: project.revision,
    machineProfileVersionId: machine.version.id,
    postId: post.id,
    postVersion: post.version,
    kind: 'nc' as const,
    sha256: manifestHash(infos),
    // E6 (D-060): the state is in the file header, so a changed state is a new hash and a new
    // record; the same state gives the same bytes and this same record.
    verificationState: machine.state,
  };
  const existing = await scope.exports.findSame(key);
  const done = async (row: ExportRow, created: boolean): Promise<StoredNc> => {
    await markProduced(scope, project.id);
    return { row, created, profileVersion: machine.version.version };
  };
  if (existing) return done(existing, false);

  const user = await defaultUser();
  const storage = companyStorage(scope.companyId);
  const exportId = newExportId();
  const folder = exportFolder(exportId);
  const stored = run.files.map((f, i) => {
    const info = infos[i];
    if (!info || info.name !== f.name) throw new Error('file list out of step');
    return {
      entry: {
        name: f.name,
        key: `${folder}/${f.name}`,
        size: info.size,
        sha256: info.hash,
        sheet: f.sheet,
      },
      bytes: fileBytes(f),
    };
  });
  const files = stored.map((s) => s.entry);
  const now = new Date();
  let saved;
  try {
    for (const s of stored) await storage.put(s.entry.key, s.bytes);
    await writeSnapshot(storage, exportId, project);
    saved = await scope.exports.createOnce({
      id: exportId,
      ...key,
      fileKey: folder,
      files,
      validationStage: storedStage(machine.state),
      unverified: run.needsAcceptance,
      acceptedUnverifiedAt: run.needsAcceptance ? now : null,
      acceptedBy: run.needsAcceptance ? user.id : null,
      createdBy: user.id,
    });
  } catch (err) {
    await removeFolder(storage, folder, files);
    throw err;
  }
  // A concurrent request stored the same export first: drop our copy, return theirs.
  if (!saved.created) await removeFolder(storage, folder, files);
  return done(saved.row, saved.created);
}

async function removeFolder(
  storage: ReturnType<typeof companyStorage>,
  folder: string,
  files: readonly { key: string }[],
): Promise<void> {
  for (const f of files) await storage.delete(f.key);
  await storage.delete(`${folder}/project.json`);
}

/** "taslak" → "üretildi" after a stored NC export; "tamamlandı" stays (spec §3.4). */
export async function markProduced(scope: CompanyScope, projectId: string): Promise<void> {
  const p = await scope.projects.get(projectId);
  if (p && p.status === 'draft') await scope.projects.setStatus(projectId, 'produced');
}
