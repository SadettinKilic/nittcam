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
export function currentControlOf(r: Pick<ExportRecord, 'kind'> & { post: { id: string } }): string {
  if (r.kind === 'nc') return 'export-checklist';
  return r.post.id === 'etiket' ? 'export-labels-download' : `export-doc-${r.post.id}`;
}

/**
 * T303 (CTO #12 on T296): a produced or completed project that was saved again after its newest
 * NC file, so "Üretildi" / "Tamamlandı" no longer describes the file on the machine. Returns the
 * two revisions to name, or null when the status still holds (draft, no NC yet, NC is current).
 */
export function changedAfterProduced(
  status: 'draft' | 'produced' | 'completed',
  revision: number,
  lastNcRevision: number | null | undefined,
): { current: number; nc: number } | null {
  if (status === 'draft' || lastNcRevision == null) return null;
  return isOldRevision(lastNcRevision, revision) ? { current: revision, nc: lastNcRevision } : null;
}
