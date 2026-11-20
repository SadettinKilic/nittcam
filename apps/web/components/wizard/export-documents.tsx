'use client';

import { Button, buttonVariants, notify } from '@nittcam/ui';
import { Download, Eye } from 'lucide-react';
import { useState } from 'react';
import type { ExportRecord } from '../../lib/exports-api';
import type { Messages } from '../../lib/messages';
import { ExportLabels } from './export-labels';

type Text = Messages['wizard']['documents'];

/** Document types the server stores (T176; `lib/server/documents.ts`). */
export type DocumentType = 'dxf-dizilim' | 'dxf-parcalar' | 'pdf-a4' | 'pdf-a3' | 'etiket';

/** URL of the project PDF of a saved revision (T172), opened inline for a look (not stored). */
export function projectPdfUrl(projectId: string, revision: number, paper: 'a4' | 'a3'): string {
  return `/api/projects/${encodeURIComponent(projectId)}/pdf?revision=${revision}&paper=${paper}`;
}

/** Starts the browser download of one stored file (the route answers `attachment`). */
export function startDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The export step's other files (T176, spec §6.6): DXF (layout, parts), the project PDF (A4, A3)
 * and the label sheet. "İndir" regenerates the file on the server from the saved revision, stores
 * it as an export record (history) and downloads it; "Önizle" opens the PDF in a new tab.
 */
export function ExportDocuments({
  t,
  projectId,
  revision,
  hasLayout,
  saved,
  pieces,
  onStored,
}: {
  t: Text;
  projectId: string | null;
  revision: number;
  hasLayout: boolean;
  saved: boolean;
  /** Total pieces of the project (one label each). */
  pieces: number;
  /** A record was stored (the history refetches). */
  onStored: () => void;
}) {
  const ready = projectId !== null && hasLayout && saved;
  const [busy, setBusy] = useState<DocumentType | null>(null);
  const link = buttonVariants({ variant: 'ghost', size: 'sm' });

  async function store(type: DocumentType, labels?: string) {
    if (!projectId) return;
    setBusy(type);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision, type, ...(labels ? { labels } : {}) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const record = (await res.json()) as ExportRecord;
      const file = record.files[0];
      if (file) startDownload(file.downloadUrl, file.name);
      onStored();
    } catch {
      notify.error(t.failed, { id: 'document-error' });
    } finally {
      setBusy(null);
    }
  }

  const row = (type: DocumentType, label: string, preview?: 'a4' | 'a3') => (
    <li key={type} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0 text-sm text-fg">{label}</span>
      <span className="flex items-center gap-1">
        {preview && ready && projectId !== null ? (
          <a
            className={link}
            href={projectPdfUrl(projectId, revision, preview)}
            target="_blank"
            rel="noopener"
            data-testid={`export-pdf-${preview}`}
          >
            <Eye aria-hidden />
            {t.preview}
          </a>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={!ready || (busy !== null && busy !== type)}
          loading={busy === type}
          data-testid={`export-doc-${type}`}
          aria-label={`${t.download}: ${label}`}
          onClick={() => void store(type)}
        >
          <Download aria-hidden />
          {t.download}
        </Button>
      </span>
    </li>
  );

  return (
    <section
      aria-labelledby="export-documents-title"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5"
      data-testid="export-documents"
    >
      <h2 id="export-documents-title" className="text-sm font-semibold tracking-tight text-fg">
        {t.title}
      </h2>
      <p className="text-xs text-fg-muted">
        {!hasLayout ? t.noLayout : !saved || projectId === null ? t.waitSave : t.hint}
      </p>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {row('dxf-dizilim', t.dxfLayout)}
        {row('dxf-parcalar', t.dxfParts)}
        {row('pdf-a4', t.pdfA4, 'a4')}
        {row('pdf-a3', t.pdfA3, 'a3')}
      </ul>
      <ExportLabels
        t={t.labels}
        projectId={projectId}
        revision={revision}
        pieces={pieces}
        ready={ready}
        busy={busy === 'etiket'}
        onDownload={(labels) => void store('etiket', labels)}
      />
    </section>
  );
}
