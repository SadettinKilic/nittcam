/**
 * Documents of the export step besides NC (T176, spec §6.6): DXF (layout, parts), the project PDF
 * (A4, A3) and the label sheet. Each one is regenerated on the server from the saved revision and
 * stored as an `exports` row like an NC export (D-064): `kind` dxf | pdf, `postId` = the document
 * type, `postVersion` = the generator version. Same revision + same options = same bytes = the
 * same record (idempotent).
 */
import { writeProjectDxf, type LabelGrid, type LabelOffset } from '@nittcam/core';
import type { CompanyScope, ExportRow } from '@nittcam/db';
import { companyStorage, defaultUser } from './company';
import { snapshotKey, writeSnapshot } from './export-snapshot';
import {
  exportFolder,
  manifestHash,
  newExportId,
  sha256Hex,
  storedStage,
  type ExportSource,
} from './exports';
import { currentCompanyMark } from './company-mark';
import { documentKind, exportFileName } from '../file-names';
import { estimateCutSeconds, pdfMachine, pdfNc, pdfOffcuts } from './pdf/cut-time';
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
  // T301: company name and logo in the header / label foot. T333: NC file and tool order.
  'pdf-a4': 'pdf-3',
  'pdf-a3': 'pdf-3',
  etiket: 'labels-2',
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
  project: ExportSource,
  type: DocumentType,
  labels?: { grid: LabelGrid; offset: LabelOffset; start?: number },
  /** Re-export of a stored document (T179): the time it was made, so it names the same NC files. */
  asOf?: Date,
): Promise<BuiltDocument> {
  const { name, revision, data } = project;
  if (type === 'dxf-dizilim' || type === 'dxf-parcalar') {
    const kind = type === 'dxf-dizilim' ? 'layout' : 'parts';
    return {
      kind: 'dxf',
      name: exportFileName(name, revision, documentKind(type), 'dxf'),
      bytes: new TextEncoder().encode(writeProjectDxf(data, kind)),
    };
  }
  if (type === 'etiket') {
    if (!labels) throw new Error('label settings missing');
    return {
      kind: 'pdf',
      name: exportFileName(name, revision, documentKind(type), 'pdf'),
      bytes: await renderLabelsPdf({
        project: data,
        projectName: name,
        revision,
        ...labels,
        company: await currentCompanyMark(scope),
      }),
    };
  }
  const paper = type === 'pdf-a3' ? 'A3' : 'A4';
  return {
    kind: 'pdf',
    name: exportFileName(name, revision, documentKind(type), 'pdf'),
    bytes: await renderProjectPdf({
      project: data,
      projectName: name,
      revision,
      paper,
      cutSeconds: await estimateCutSeconds(scope, project),
      company: await currentCompanyMark(scope),
      machine: await pdfMachine(scope, project.data),
      offcuts: await pdfOffcuts(scope, project.data),
      nc: await pdfNc(scope, project, asOf),
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
  project: ExportSource,
  type: DocumentType,
  doc: BuiltDocument,
  /** Label settings query string (`etiket`), kept in the snapshot for re-export (T179). */
  labels?: string,
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
  let saved;
  try {
    await storage.put(entry.key, doc.bytes);
    await writeSnapshot(storage, exportId, project, labels);
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
    await storage.delete(snapshotKey(exportId));
    throw err;
  }
  if (!saved.created) {
    await storage.delete(entry.key);
    await storage.delete(snapshotKey(exportId));
  }
  return {
    kind: 'stored',
    row: saved.row,
    created: saved.created,
    profileVersion: machine.version.version,
  };
}
