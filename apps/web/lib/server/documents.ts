/**
 * Documents of the export step besides NC (T176, spec §6.6): DXF (layout, parts), the project PDF
 * (A4, A3) and the label sheet. Each one is regenerated on the server from the saved revision and
 * stored as an `exports` row like an NC export (D-064): `kind` dxf | pdf, `postId` = the document
 * type, `postVersion` = the generator version. Same revision + same options = same bytes = the
 * same record (idempotent).
 */
import { writeProjectDxf, type LabelGrid, type LabelOffset } from '@nittcam/core';
import type { CompanyScope, ExportRow, ProjectRow } from '@nittcam/db';
import { companyStorage, defaultUser } from './company';
import { exportFolder, manifestHash, newExportId, sha256Hex, storedStage } from './exports';
import { documentFileName } from './file-names';
import { estimateCutSeconds } from './pdf/cut-time';
import { renderLabelsPdf } from './pdf/labels-pdf';
import { renderProjectPdf } from './pdf/project-pdf';

export const DOCUMENT_TYPES = [
  'dxf-dizilim',
  'dxf-parcalar',
  'pdf-a4',
  'pdf-a3',
  'etiket',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Generator versions: bump one when its output bytes change on purpose. */
export const DOCUMENT_GENERATORS: Readonly<Record<DocumentType, string>> = {
  'dxf-dizilim': 'dxf-r12-1',
  'dxf-parcalar': 'dxf-r12-1',
  'pdf-a4': 'pdf-1',
  'pdf-a3': 'pdf-1',
  etiket: 'labels-1',
};

export function isDocumentType(v: unknown): v is DocumentType {
  return typeof v === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(v);
}

export interface BuiltDocument {
  kind: 'dxf' | 'pdf';
  name: string;
  bytes: Uint8Array;
}

/** The file of one document type for a stored project (its current revision). */
export async function buildDocument(
  scope: CompanyScope,
  project: ProjectRow,
  type: DocumentType,
  labels?: { grid: LabelGrid; offset: LabelOffset },
): Promise<BuiltDocument> {
  const { name, revision, data } = project;
  if (type === 'dxf-dizilim' || type === 'dxf-parcalar') {
    const kind = type === 'dxf-dizilim' ? 'layout' : 'parts';
    return {
      kind: 'dxf',
      name: documentFileName(name, revision, type.slice(4), 'dxf'),
      bytes: new TextEncoder().encode(writeProjectDxf(data, kind)),
    };
  }
  if (type === 'etiket') {
    if (!labels) throw new Error('label settings missing');
    return {
      kind: 'pdf',
      name: documentFileName(name, revision, 'etiket', 'pdf'),
      bytes: await renderLabelsPdf({ project: data, projectName: name, revision, ...labels }),
    };
  }
  const paper = type === 'pdf-a3' ? 'A3' : 'A4';
  return {
    kind: 'pdf',
    name: documentFileName(name, revision, paper.toLowerCase(), 'pdf'),
    bytes: await renderProjectPdf({
      project: data,
      projectName: name,
      revision,
      paper,
      cutSeconds: await estimateCutSeconds(scope, project),
    }),
  };
}

export type StoreResult =
  | { kind: 'noMachine' }
  | { kind: 'stored'; row: ExportRow; created: boolean; profileVersion: number };

/**
 * Stores a built document as an export record of the project's pinned machine profile version
 * (the row needs one; documents are not machine files, so no acceptance applies). An identical
 * record (same revision, profile version, type, generator and bytes) is returned as it is.
 */
export async function storeDocument(
  scope: CompanyScope,
  project: ProjectRow,
  type: DocumentType,
  doc: BuiltDocument,
): Promise<StoreResult> {
  const pin = project.data.machine;
  const machine = await scope.machines.getProfileVersion(pin.machineId, {
    version: pin.profileVersion,
  });
  if (!machine) return { kind: 'noMachine' };
  const hash = sha256Hex(doc.bytes);
  const key = {
    projectId: project.id,
    projectRevision: project.revision,
    machineProfileVersionId: machine.version.id,
    postId: type,
    postVersion: DOCUMENT_GENERATORS[type],
    kind: doc.kind,
    sha256: manifestHash([{ name: doc.name, hash }]),
  };
  const existing = await scope.exports.findSame(key);
  if (existing) {
    return {
      kind: 'stored',
      row: existing,
      created: false,
      profileVersion: machine.version.version,
    };
  }
  const user = await defaultUser();
  const storage = companyStorage(scope.companyId);
  const exportId = newExportId();
  const folder = exportFolder(exportId);
  const entry = {
    name: doc.name,
    key: `${folder}/${doc.name}`,
    size: doc.bytes.byteLength,
    sha256: hash,
    sheet: 0,
  };
  await storage.put(entry.key, doc.bytes);
  let saved;
  try {
    saved = await scope.exports.createOnce({
      id: exportId,
      ...key,
      fileKey: folder,
      files: [entry],
      validationStage: storedStage(machine.state),
      verificationState: machine.state,
      unverified: false,
      acceptedUnverifiedAt: null,
      acceptedBy: null,
      createdBy: user.id,
    });
  } catch (err) {
    await storage.delete(entry.key);
    throw err;
  }
  if (!saved.created) await storage.delete(entry.key);
  return {
    kind: 'stored',
    row: saved.row,
    created: saved.created,
    profileVersion: machine.version.version,
  };
}
