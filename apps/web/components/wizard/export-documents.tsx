'use client';

import { buttonVariants } from '@nittcam/ui';
import { FileText } from 'lucide-react';
import type { Messages } from '../../lib/messages';
import { ExportLabels } from './export-labels';

type Text = Messages['wizard']['documents'];

/** URL of the project PDF of a saved revision (T172). */
export function projectPdfUrl(projectId: string, revision: number, paper: 'a4' | 'a3'): string {
  return `/api/projects/${encodeURIComponent(projectId)}/pdf?revision=${revision}&paper=${paper}`;
}

/**
 * The PDF documents of the export step (T172, spec §6.6): opened in a new tab, generated on the
 * server from the saved revision, and the label sheet (T174). Kept small: the export step is rebuilt with every format in T176.
 */
export function ExportDocuments({
  t,
  projectId,
  revision,
  hasLayout,
  saved,
  pieces,
}: {
  t: Text;
  projectId: string | null;
  revision: number;
  hasLayout: boolean;
  saved: boolean;
  /** Total pieces of the project (one label each). */
  pieces: number;
}) {
  const ready = projectId !== null && hasLayout && saved;
  const link = buttonVariants({ variant: 'outline', size: 'sm' });
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
      {ready ? (
        <div className="flex flex-wrap gap-2">
          {(['a4', 'a3'] as const).map((paper) => (
            <a
              key={paper}
              className={link}
              href={projectPdfUrl(projectId, revision, paper)}
              target="_blank"
              rel="noopener"
              data-testid={`export-pdf-${paper}`}
            >
              <FileText aria-hidden />
              {t[paper]}
            </a>
          ))}
        </div>
      ) : null}
      <ExportLabels
        t={t.labels}
        projectId={projectId}
        revision={revision}
        pieces={pieces}
        ready={ready}
      />
    </section>
  );
}
