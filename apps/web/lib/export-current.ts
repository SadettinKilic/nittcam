import type { ExportRecord } from './exports-api';

/** T296: a file made from an older saved revision than the project has now. */
export function isOldRevision(fileRevision: number, projectRevision: number): boolean {
  return fileRevision < projectRevision;
}

/**
 * T296: test id of the export-step control that makes the file of a history row again for the
 * current revision: NC → the pre-export checklist (D-071/D-072: a machine file is confirmed on the
 * revision it is made from), documents → their "İndir" button (labels: the label card's button,
 * which keeps the label settings).
 */
export function currentControlOf(r: Pick<ExportRecord, 'kind' | 'post'>): string {
  if (r.kind === 'nc') return 'export-checklist';
  return r.post.id === 'etiket' ? 'export-labels-download' : `export-doc-${r.post.id}`;
}
