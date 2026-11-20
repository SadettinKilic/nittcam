'use client';

import { Badge, Button, notify } from '@nittcam/ui';
import { CircleCheck, RefreshCw, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { changedAfterProduced } from '../../lib/export-current';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import {
  PROJECT_STATUS_TONE,
  type ProjectDetail,
  type ProjectStatus,
} from '../../lib/projects-api';

type Text = Messages['wizard']['projectStatus'];
type Names = Messages['projects']['status'];

/**
 * Project status on the export step (T179, spec §3.4): taslak → üretildi (set by the server after
 * a stored NC export) → tamamlandı (by hand here, and back). `tick` changes after every export so
 * the status is read again.
 */
export function ProjectStatusCard({
  t,
  names,
  projectId,
  tick,
  onRegenerate,
}: {
  t: Text;
  names: Names;
  projectId: string | null;
  tick: number;
  /** T303: go to the control that makes the NC file of the current revision. */
  onRegenerate?: () => void;
}) {
  const key = projectId ? `${projectId}#${tick}` : '';
  const [state, setState] = useState<{
    key: string;
    status: ProjectStatus;
    revision: number;
    lastNcRevision: number | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!live || !res.ok) return;
        const body = (await res.json()) as ProjectDetail;
        setState({
          key,
          status: body.status,
          revision: body.revision,
          lastNcRevision: body.lastNcRevision ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId, key]);
  // Keep the last known status while it is read again after an export.
  const status = state?.status ?? null;
  if (!projectId || status === null || !state) return null;
  const changed = changedAfterProduced(status, state.revision, state.lastNcRevision);

  async function change(next: 'completed' | 'produced') {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState((s) => (s ? { ...s, key, status: next } : s));
    } catch {
      notify.error(t.error, { id: 'project-status' });
    } finally {
      setBusy(false);
    }
  }

  const hint =
    status === 'draft' ? t.hintDraft : status === 'produced' ? t.hintProduced : t.hintCompleted;
  return (
    <section
      aria-labelledby="project-status-title"
      data-testid="project-status"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="project-status-title" className="text-sm font-semibold tracking-tight text-fg">
          {t.title}
        </h2>
        <Badge variant={PROJECT_STATUS_TONE[status]} data-testid="project-status-badge">
          {names[status]}
        </Badge>
      </div>
      <p className="text-xs text-fg-muted">{hint}</p>
      {changed ? (
        // T303: "Üretildi" no longer describes the file on the machine; say so, one click to redo.
        <div
          className="flex flex-col items-start gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning-text"
          data-testid="project-status-changed"
        >
          <p className="flex items-start gap-1.5 font-medium">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {fill(t.changed, changed)}
          </p>
          {onRegenerate ? (
            <Button
              variant="outline"
              size="sm"
              data-testid="project-status-regenerate"
              onClick={onRegenerate}
            >
              <RefreshCw aria-hidden />
              {t.regenerate}
            </Button>
          ) : null}
        </div>
      ) : null}
      {status === 'produced' ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={busy}
          data-testid="project-status-complete"
          onClick={() => void change('completed')}
        >
          <CircleCheck aria-hidden />
          {t.markCompleted}
        </Button>
      ) : status === 'completed' ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={busy}
          data-testid="project-status-undo"
          onClick={() => void change('produced')}
        >
          <Undo2 aria-hidden />
          {t.markProduced}
        </Button>
      ) : null}
    </section>
  );
}
