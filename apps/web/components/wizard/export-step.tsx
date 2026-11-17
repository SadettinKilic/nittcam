'use client';

import Link from 'next/link';
import type { Project } from '@nittcam/core';
import { useEffect, useState } from 'react';
import { fill } from '../../lib/draft-project';
import {
  downloadBlocker,
  EMPTY_CHECKLIST,
  errorCount,
  type ChecklistState,
} from '../../lib/export-gate';
import {
  shortHash,
  type ExportApiError,
  type ExportPreview,
  type ExportRecord,
  type ExportResponse,
  type ExportViolation,
} from '../../lib/exports-api';
import type { SaveState } from '../../lib/autosave';
import type { Messages } from '../../lib/messages';
import type { SimMachine } from '../simulation/simulation-view';
import { buttonClass } from '../parts/ui';

type Text = Messages['wizard']['export'];
type Corners = Messages['machines']['form']['options']['corner'];
type States = Messages['machines']['state'];

type PreviewState =
  | { key: string; status: 'ok'; preview: ExportPreview }
  | { key: string; status: 'stale' }
  | { key: string; status: 'error' };

type DownloadState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; record: ExportRecord }
  | { status: 'failed'; count: number }
  | { status: 'error' };

/** Starts the browser download of one stored file (the route answers `attachment`). */
function startDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-border border-t-accent"
    />
  );
}

/**
 * Step 5 "Dışa aktar" (spec §3.6 step 5, §6.6, §7.2 rules 9–10, §8.2; T021, D-030). The server
 * regenerates the NC files from the **saved** revision with the profile version the project stores
 * and runs the automatic checks; this step shows that dry run, the pre-export checklist (origin,
 * tool, air cut), the acceptance of an unverified profile, then stores and downloads the files.
 */
export function ExportStep({
  t,
  corners,
  states,
  project,
  machine,
  projectId,
  revision,
  saved,
  saveState,
}: {
  t: Text;
  corners: Corners;
  states: States;
  project: Project;
  machine: SimMachine | null;
  projectId: string | null;
  revision: number;
  /** False while changes wait for the autosave. */
  saved: boolean;
  saveState: SaveState;
}) {
  const hasLayout = project.layout.sheets.length > 0;
  const busySaving = !saved || saveState === 'pending' || saveState === 'saving';
  const canRun = machine !== null && hasLayout && projectId !== null && !busySaving;
  const [attempt, setAttempt] = useState(0);
  const key = canRun ? `${projectId}@${revision}#${attempt}` : '';

  const [state, setState] = useState<PreviewState | null>(null);
  useEffect(() => {
    if (!canRun || projectId === null) return;
    let live = true;
    const url = `/api/projects/${encodeURIComponent(projectId)}/export?revision=${revision}`;
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 409) setState({ key, status: 'stale' });
        else if (res.ok)
          setState({ key, status: 'ok', preview: (await res.json()) as ExportPreview });
        else setState({ key, status: 'error' });
      })
      .catch(() => {
        if (live) setState({ key, status: 'error' });
      });
    return () => {
      live = false;
    };
  }, [canRun, projectId, revision, key]);
  const current = state && state.key === key ? state : null;
  const preview = current?.status === 'ok' ? current.preview : null;

  // Checklist, acceptance and the download result belong to one saved revision.
  const [form, setForm] = useState<{
    key: string;
    checks: ChecklistState;
    accepted: boolean;
    download: DownloadState;
  }>({ key: '', checks: EMPTY_CHECKLIST, accepted: false, download: { status: 'idle' } });
  const formKey = canRun ? `${projectId}@${revision}` : '';
  const f =
    form.key === formKey
      ? form
      : {
          key: formKey,
          checks: EMPTY_CHECKLIST,
          accepted: false,
          download: { status: 'idle' } as DownloadState,
        };
  const update = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });

  // Export history of the project (refetched after each stored export).
  const [historyTick, setHistoryTick] = useState(0);
  const [history, setHistory] = useState<{
    key: string;
    rows: ExportRecord[] | null;
  } | null>(null);
  const historyKey = projectId ? `${projectId}#${historyTick}` : '';
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/exports`, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        setHistory({
          key: historyKey,
          rows: res.ok ? ((await res.json()) as ExportRecord[]) : null,
        });
      })
      .catch(() => {
        if (live) setHistory({ key: historyKey, rows: null });
      });
    return () => {
      live = false;
    };
  }, [projectId, historyKey]);

  const blocker = downloadBlocker(preview, f.checks, f.accepted);

  async function doExport() {
    if (!projectId || !preview) return;
    setForm({ ...f, download: { status: 'busy' } });
    let download: DownloadState;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          revision,
          ...(preview.needsAcceptance ? { acceptUnverified: f.accepted } : {}),
        }),
      });
      if (res.ok) {
        const record = (await res.json()) as ExportResponse;
        download = { status: 'done', record };
        const only = record.files.length === 1 ? record.files[0] : undefined;
        if (only) startDownload(only.downloadUrl, only.name);
        setHistoryTick((n) => n + 1);
      } else if (res.status === 409) {
        setAttempt((n) => n + 1);
        download = { status: 'error' };
      } else if (res.status === 422) {
        const body = (await res.json()) as ExportApiError;
        download = {
          status: 'failed',
          count: body.error === 'export_failed' ? errorCount(body) : 1,
        };
      } else {
        download = { status: 'error' };
      }
    } catch {
      download = { status: 'error' };
    }
    setForm({ ...f, download });
  }

  let status: React.ReactNode;
  if (!machine) status = <p className="text-sm text-fg-muted">{t.noMachine}</p>;
  else if (!hasLayout) status = <p className="text-sm text-fg-muted">{t.noLayout}</p>;
  else if (projectId === null) {
    status = (
      <p data-testid="export-not-created" className="text-sm text-fg-muted">
        {t.notCreated}
      </p>
    );
  } else if (saveState === 'conflict' || current?.status === 'stale') {
    status = (
      <p
        role="alert"
        data-testid="export-stale"
        className="rounded-lg bg-danger-bg p-3 text-sm text-danger"
      >
        {t.stale}
      </p>
    );
  } else if (busySaving) {
    status = (
      <p
        role="status"
        data-testid="export-checking"
        className="flex items-center gap-2 text-sm text-fg-muted"
      >
        <Spinner />
        {t.waitingSave}
      </p>
    );
  } else if (!current) {
    status = (
      <p
        role="status"
        data-testid="export-checking"
        className="flex items-center gap-2 text-sm text-fg-muted"
      >
        <Spinner />
        {t.checking}
      </p>
    );
  } else if (current.status === 'error') {
    status = (
      <div
        role="alert"
        className="flex flex-col items-start gap-2 rounded-lg bg-danger-bg p-3 text-sm text-danger"
      >
        <p>{t.failedRun}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className={`${buttonClass} border border-border bg-bg text-fg`}
        >
          {t.retry}
        </button>
      </div>
    );
  } else if (current.preview.ok) {
    status = (
      <p
        data-testid="export-status"
        data-ok="true"
        className="rounded-lg bg-ok-bg p-3 text-sm font-semibold text-ok"
      >
        <span aria-hidden="true">✓ </span>
        {t.passed}
      </p>
    );
  } else {
    status = (
      <div className="flex flex-col gap-2">
        <p
          data-testid="export-status"
          data-ok="false"
          role="alert"
          className="rounded-lg bg-danger-bg p-3 text-sm text-danger"
        >
          {fill(t.failed, { count: errorCount(current.preview) })}
        </p>
        <Violations t={t} violations={current.preview.violations} />
      </div>
    );
  }

  return (
    <>
      <aside className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-4">
        <h2 className="text-base font-semibold">{t.checks}</h2>
        {status}
        {preview?.profile ? (
          <div className="flex flex-col gap-1 text-xs text-fg-muted" data-testid="export-profile">
            <p>
              {fill(t.profile, {
                machine: preview.profile.machineName,
                version: preview.profile.version,
                state: states[preview.profile.verification],
              })}
            </p>
            {preview.profile.version < preview.profile.latestVersion ? (
              <p className="text-warn" data-testid="export-profile-old">
                {fill(t.profileOld, {
                  version: preview.profile.version,
                  latest: preview.profile.latestVersion,
                })}
              </p>
            ) : null}
            {preview.post ? (
              <p>{fill(t.post, { name: preview.post.name, version: preview.post.version })}</p>
            ) : null}
          </div>
        ) : null}
        {preview && preview.files.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t.filesTitle}</h3>
            <ul className="flex flex-col gap-1 text-xs" data-testid="export-files">
              {preview.files.map((file) => (
                <li key={file.name} title={file.hash} className="min-w-0 break-all">
                  {fill(t.fileLine, {
                    name: file.name,
                    size: file.size,
                    hash: shortHash(file.hash),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
      <section
        aria-labelledby="export-title"
        className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-4"
      >
        <h2 id="export-title" className="text-xl font-semibold">
          {t.title}
        </h2>
        <p className="text-sm text-fg-muted" data-testid="export-revision">
          {fill(t.revision, { n: revision })}
        </p>
        {saved ? null : <p className="text-xs text-warn">{t.unsaved}</p>}
        <p className="text-xs text-fg-muted">{t.serverNote}</p>

        {preview?.ok && preview.needsAcceptance ? (
          <div
            role="alert"
            data-testid="export-unverified"
            className="flex flex-col gap-2 rounded-lg bg-warn-bg p-3 text-sm text-warn"
          >
            <p className="font-semibold">{t.unverifiedTitle}</p>
            <p>{t.unverifiedBody}</p>
            {(preview.unverifiedReasons ?? []).length > 0 ? (
              <ul className="list-disc pl-5" data-testid="export-unverified-reasons">
                {(preview.unverifiedReasons ?? []).map((r) => (
                  <li key={r}>{t.reasons[r]}</li>
                ))}
              </ul>
            ) : null}
            {preview.profile ? (
              <Link
                href={`/makineler/${preview.profile.machineId}/dogrulama`}
                data-testid="export-verify-link"
                className="font-medium underline"
              >
                {t.unverifiedLink}
              </Link>
            ) : null}
            <label className="flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                data-testid="export-accept"
                checked={f.accepted}
                onChange={(e) => update({ accepted: e.target.checked })}
                className="mt-0.5"
              />
              {t.accept}
            </label>
          </div>
        ) : null}

        {preview?.ok ? (
          <fieldset
            className="flex flex-col gap-2 rounded-lg border border-border p-3"
            data-testid="export-checklist"
          >
            <legend className="px-1 text-sm font-semibold">{t.checklistTitle}</legend>
            <ChecklistItem
              testId="export-check-origin"
              checked={f.checks.origin}
              onChange={(v) => update({ checks: { ...f.checks, origin: v } })}
              label={fill(t.checkOrigin, {
                corner: preview.checklist ? corners[preview.checklist.origin.corner] : '-',
              })}
            />
            <ChecklistItem
              testId="export-check-tool"
              checked={f.checks.tool}
              onChange={(v) => update({ checks: { ...f.checks, tool: v } })}
              label={
                preview.checklist && preview.checklist.tools.length > 0
                  ? fill(t.checkTool, {
                      tools: preview.checklist.tools
                        .map((tool) => `T${tool.number} Ø${tool.diameter} mm`)
                        .join(', '),
                    })
                  : t.checkToolNone
              }
            />
            <ChecklistItem
              testId="export-check-aircut"
              checked={f.checks.airCut}
              onChange={(v) => update({ checks: { ...f.checks, airCut: v } })}
              label={t.checkAirCut}
            />
            <p className="text-xs text-fg-muted">{t.airCutNote}</p>
          </fieldset>
        ) : null}

        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            disabled={blocker !== null || f.download.status === 'busy'}
            aria-describedby="export-hint"
            data-testid="export-download"
            onClick={() => void doExport()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {f.download.status === 'busy' ? t.downloading : t.download}
          </button>
          <p id="export-hint" data-testid="export-hint" className="text-sm text-fg-muted">
            {blocker === 'checks'
              ? t.needPass
              : blocker === 'checklist'
                ? t.needChecks
                : blocker === 'accept'
                  ? t.needAccept
                  : null}
          </p>
          <DownloadResult t={t} state={f.download} />
        </div>

        <History
          t={t}
          states={states}
          rows={history?.key === historyKey ? history.rows : undefined}
        />
      </section>
    </>
  );
}

function ChecklistItem({
  testId,
  checked,
  onChange,
  label,
}: {
  testId: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      {label}
    </label>
  );
}

function Violations({ t, violations }: { t: Text; violations: ExportViolation[] }) {
  const errors = violations.filter((v) => v.severity === 'error');
  if (errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{t.violationsTitle}</h3>
      <ul className="flex flex-col gap-1 text-xs" data-testid="export-violations">
        {errors.map((v, i) => (
          <li key={`${v.code}-${i}`} className="min-w-0 break-words">
            <span className="font-mono">{v.rule}</span> {v.message}
            {v.file && v.line ? (
              <span className="text-fg-muted">
                {' '}
                ({fill(t.violationAt, { file: v.file, line: v.line })})
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DownloadResult({ t, state }: { t: Text; state: DownloadState }) {
  if (state.status === 'failed') {
    return (
      <p role="alert" className="text-sm text-danger">
        {fill(t.exportFailed, { count: state.count })}
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        {t.exportError}
      </p>
    );
  }
  if (state.status !== 'done') return null;
  const files = state.record.files;
  return (
    <div role="status" data-testid="export-ready" className="flex flex-col gap-1 text-sm text-ok">
      <p>{files.length === 1 ? t.ready : t.readyMany}</p>
      <ul className="flex flex-col gap-1">
        {files.map((file) => (
          <li key={file.name}>
            <a href={file.downloadUrl} download={file.name} className="text-accent underline">
              {fill(t.downloadFile, { name: file.name })}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({
  t,
  states,
  rows,
}: {
  t: Text;
  states: States;
  /** undefined = loading, null = error. */
  rows: ExportRecord[] | null | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="export-history">
      <h3 className="text-base font-semibold">{t.historyTitle}</h3>
      {rows === undefined ? null : rows === null ? (
        <p className="text-sm text-danger">{t.historyError}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.historyEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-fg-muted">
                <th className="py-1 pr-2 font-medium">{t.historyColumns.date}</th>
                <th className="py-1 pr-2 font-medium">{t.historyColumns.revision}</th>
                <th className="py-1 pr-2 font-medium">{t.historyColumns.post}</th>
                <th className="py-1 pr-2 font-medium">{t.historyColumns.profile}</th>
                <th className="py-1 pr-2 font-medium">{t.historyColumns.state}</th>
                <th className="py-1 font-medium">{t.historyColumns.files}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.exportId}
                  className="border-t border-border align-top"
                  data-testid="export-history-row"
                >
                  <td className="py-1 pr-2 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                  <td className="py-1 pr-2">{fill(t.historyRevision, { n: r.revision })}</td>
                  <td className="py-1 pr-2 font-mono">
                    {r.post.id} {r.post.version}
                  </td>
                  <td className="py-1 pr-2">
                    {r.profileVersion === null
                      ? '-'
                      : fill(t.historyProfile, { n: r.profileVersion })}
                  </td>
                  <td className="py-1 pr-2">
                    {(states as Record<string, string>)[r.verification] ?? r.verification}
                    {r.acceptedUnverifiedAt ? ` · ${t.historyAccepted}` : ''}
                  </td>
                  <td className="py-1">
                    <ul className="flex flex-col gap-0.5">
                      {r.files.map((file) => (
                        <li key={file.name}>
                          <a
                            href={file.downloadUrl}
                            download={file.name}
                            title={file.hash}
                            className="text-accent underline break-all"
                          >
                            {fill(t.redownload, { name: file.name })}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
