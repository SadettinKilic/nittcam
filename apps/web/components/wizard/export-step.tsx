'use client';

import Link from 'next/link';
import { hingeEdgeHandleParts, unverifiedTemplateNames, type Project } from '@nittcam/core';
import { Button, Card, Checkbox, IconButton, Tooltip, notify } from '@nittcam/ui';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  FileCode,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { focusRing } from '../page/page-header';
import { Callout } from './panels';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fill } from '../../lib/draft-project';
import { itemPlace, machineRelated } from '../../lib/part-items';
import {
  downloadBlocker,
  EMPTY_CHECKLIST,
  errorCount,
  type ChecklistState,
} from '../../lib/export-gate';
import {
  formatFileSize,
  ruleLabel,
  shortHash,
  splitFileName,
  type ExportApiError,
  type ExportFileInfo,
  type ExportPreview,
  type ExportRecord,
  type ExportResponse,
  type ExportViolation,
} from '../../lib/exports-api';
import type { SaveState } from '../../lib/autosave';
import { getMessages, type Messages } from '../../lib/messages';
import { ExportDocuments } from './export-documents';
import { ReportCard } from './report-card';
import type { SimMachine } from '../simulation/simulation-view';

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
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent"
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
  notice,
  onOpenPart,
  projectId,
  revision,
  saved,
  saveState,
  footerSlot,
}: {
  t: Text;
  corners: Corners;
  states: States;
  project: Project;
  machine: SimMachine | null;
  /** T269: the "Son sürüme geç" box when the machine has a newer profile version. */
  notice?: React.ReactNode;
  /** T270: opens a part on the drawing board (a blocked cut-out links there). */
  onOpenPart?: (partId: string, hole?: number) => void;
  projectId: string | null;
  revision: number;
  /** False while changes wait for the autosave. */
  saved: boolean;
  saveState: SaveState;
  /** T250 (D-040): the wizard footer's right-hand slot; the step's "İndir" lives there. */
  footerSlot: HTMLElement | null;
}) {
  const acceptId = useId();
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

  // T282: unverified ready-template values get their own checklist line (review #8 K2).
  const templateNames = useMemo(() => unverifiedTemplateNames(project.parts), [project.parts]);
  // T286: a handle on a hinge edge is a warning line, never a blocker (review #9 A).
  const hingeHandleParts = useMemo(() => hingeEdgeHandleParts(project.parts), [project.parts]);
  const blocker = downloadBlocker(preview, f.checks, f.accepted, templateNames.length);
  const blockerText =
    blocker === 'checks'
      ? t.needPass
      : blocker === 'checklist'
        ? t.needChecks
        : blocker === 'accept'
          ? t.needAccept
          : null;

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
    // Network/server failures are a toast with a retry (T105); validation failures stay inline.
    if (download.status === 'error') {
      notify.error(t.exportError, {
        id: 'export-error',
        action: { label: t.retry, onClick: () => void exportRef.current() },
      });
    }
  }
  const exportRef = useRef(doExport);
  useEffect(() => {
    exportRef.current = doExport;
  });

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
        className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
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
        className="flex flex-col items-start gap-2 rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
      >
        <p>{t.failedRun}</p>
        <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          {t.retry}
        </Button>
      </div>
    );
  } else if (current.preview.ok) {
    status = (
      <p
        data-testid="export-status"
        data-ok="true"
        className="flex items-center gap-2 rounded-lg border border-success-border bg-success-subtle px-3 py-2.5 text-sm font-semibold text-success-text"
      >
        <CircleCheck aria-hidden className="size-4 shrink-0" />
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
          className="flex items-center gap-2 rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm font-semibold text-danger-text"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {fill(t.failed, { count: errorCount(current.preview) })}
        </p>
        <Violations
          t={t}
          violations={current.preview.violations}
          parts={project.parts}
          onOpenPart={onOpenPart}
        />
      </div>
    );
  }

  return (
    <>
      <aside className="flex min-w-0 flex-col gap-4">
        <section
          aria-labelledby="export-checks-title"
          className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5"
        >
          <h2 id="export-checks-title" className="text-sm font-semibold tracking-tight text-fg">
            {t.checks}
          </h2>
          {status}
          {notice}
          {preview?.profile ? (
            <div className="flex flex-col gap-1 text-xs text-fg-muted" data-testid="export-profile">
              <p>
                {fill(t.profile, {
                  machine: preview.profile.machineName,
                  version: preview.profile.version,
                  state: states[preview.profile.verification],
                })}
              </p>
              {preview.post ? (
                <p>{fill(t.post, { name: preview.post.name, version: preview.post.version })}</p>
              ) : null}
            </div>
          ) : null}
        </section>
        <ReportCard
          t={getMessages().wizard.report}
          projectId={projectId}
          revision={revision}
          hasLayout={hasLayout}
          saved={!busySaving}
        />
        {preview && preview.files.length > 0 ? (
          <section
            aria-labelledby="export-files-title"
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5"
          >
            <h2 id="export-files-title" className="text-sm font-semibold tracking-tight text-fg">
              {t.filesTitle}
            </h2>
            <ul className="flex flex-col gap-2" data-testid="export-files">
              {preview.files.map((file) => (
                <li
                  key={file.name}
                  className="min-w-0 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2"
                >
                  <FileRow t={t} file={file} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section
          aria-labelledby="export-title"
          className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-6"
        >
          <div className="flex flex-col gap-1">
            <h2 id="export-title" className="text-base font-semibold tracking-tight text-fg">
              {t.title}
            </h2>
            <p className="text-sm text-fg-muted" data-testid="export-revision">
              {fill(t.revision, { n: revision })}
            </p>
            {saved ? null : <p className="text-xs text-warning-text">{t.unsaved}</p>}
            <p className="text-xs text-fg-subtle">{t.serverNote}</p>
          </div>

          {preview?.ok && preview.needsAcceptance ? (
            <Callout
              tone="warning"
              role="alert"
              data-testid="export-unverified"
              icon={<ShieldAlert aria-hidden />}
              className="gap-3 p-4"
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
                  className={`self-start font-medium underline underline-offset-4 ${focusRing}`}
                >
                  {t.unverifiedLink}
                </Link>
              ) : null}
              <div className="mt-1 flex items-start gap-2.5 rounded-lg border border-warning-border bg-surface px-3 py-2.5 font-medium text-fg">
                <Checkbox
                  id={acceptId}
                  data-testid="export-accept"
                  checked={f.accepted}
                  onCheckedChange={(v) => update({ accepted: v === true })}
                  className="mt-0.5 data-[state=checked]:border-warning data-[state=checked]:bg-warning data-[state=checked]:text-warning-fg"
                />
                <label htmlFor={acceptId} className="cursor-pointer">
                  {t.accept}
                </label>
              </div>
            </Callout>
          ) : null}

          {preview?.ok ? (
            <fieldset className="flex min-w-0 flex-col gap-2" data-testid="export-checklist">
              <legend className="mb-2 text-sm font-semibold text-fg">{t.checklistTitle}</legend>
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
                          .join(' → '),
                      })
                    : t.checkToolNone
                }
              />
              {preview.checklist && preview.checklist.toolChanges > 0 ? (
                <ChecklistItem
                  testId="export-check-toolchange"
                  checked={f.checks.toolChange}
                  onChange={(v) => update({ checks: { ...f.checks, toolChange: v } })}
                  label={fill(preview.checklist.rezeroZ ? t.checkToolChangeZ : t.checkToolChange, {
                    count: preview.checklist.toolChanges,
                  })}
                />
              ) : null}
              {templateNames.length > 0 ? (
                <ChecklistItem
                  testId="export-check-templates"
                  checked={f.checks.templates}
                  onChange={(v) => update({ checks: { ...f.checks, templates: v } })}
                  label={fill(t.checkTemplates, { names: templateNames.join(', ') })}
                />
              ) : null}
              {hingeHandleParts.length > 0 ? (
                <p
                  className="flex items-start gap-1.5 text-sm text-warning-text"
                  data-testid="export-hinge-handle"
                >
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {fill(t.hingeHandle, { names: hingeHandleParts.join(', ') })}
                </p>
              ) : null}
              <ChecklistItem
                testId="export-check-aircut"
                checked={f.checks.airCut}
                onChange={(v) => update({ checks: { ...f.checks, airCut: v } })}
                label={t.checkAirCut}
              />
              <p className="flex items-start gap-1.5 text-xs text-warning-text">
                <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                {t.airCutNote}
              </p>
            </fieldset>
          ) : null}

          {/* T250 (D-040): one download action per screen, the footer's "İndir"; the result stays
            here. Below 640 px the footer has no room for the reason, so it is repeated here. */}
          {blockerText ? <p className="text-sm text-fg-muted sm:hidden">{blockerText}</p> : null}
          {f.download.status === 'failed' || f.download.status === 'done' ? (
            <div className="flex flex-col items-start gap-2 border-t border-border-subtle pt-5">
              <DownloadResult t={t} state={f.download} />
            </div>
          ) : null}
          {footerSlot
            ? createPortal(
                <>
                  <p
                    id="export-hint"
                    data-testid="export-hint"
                    className="hidden min-w-0 truncate text-sm text-fg-muted sm:block"
                    {...(blockerText ? { title: blockerText } : {})}
                  >
                    {blockerText}
                  </p>
                  <Button
                    disabled={blocker !== null || f.download.status === 'busy'}
                    aria-describedby="export-hint"
                    aria-busy={f.download.status === 'busy'}
                    data-testid="export-download"
                    className="shrink-0"
                    onClick={() => void doExport()}
                  >
                    <Download aria-hidden />
                    {f.download.status === 'busy' ? t.downloading : t.download}
                  </Button>
                </>,
                footerSlot,
              )
            : null}
        </section>
      </aside>
      {/* T176 (CTO #4): two balanced columns; the other files and the history sit on the right,
          so the history is in view without scrolling past the NC checklist. */}
      <div className="flex min-w-0 flex-col gap-4">
        <ExportDocuments
          t={getMessages().wizard.documents}
          projectId={projectId}
          revision={revision}
          hasLayout={hasLayout}
          saved={!busySaving}
          pieces={project.parts.reduce((n, p) => n + p.qty, 0)}
          onStored={() => setHistoryTick((n) => n + 1)}
        />
        <History
          t={t}
          states={states}
          rows={history?.key === historyKey ? history.rows : undefined}
        />
      </div>
    </>
  );
}

/**
 * One export file (T250): line 1 the name in mono, cut in the middle if needed (the sheet number
 * and extension stay visible); line 2 the Turkish size and the first 8 characters of the sha256,
 * the full hash in the copy button's tooltip and on the clipboard. Never breaks inside a word.
 */
function FileRow({
  t,
  file,
  href,
  linkLabel,
}: {
  t: Text;
  file: ExportFileInfo;
  href?: string;
  linkLabel?: string;
}) {
  const [head, tail] = splitFileName(file.name);
  const name = (
    <span className="flex min-w-0 font-mono text-xs whitespace-nowrap" title={file.name}>
      {head ? <span className="min-w-0 truncate">{head}</span> : null}
      <span className="shrink-0">{tail}</span>
    </span>
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(file.hash);
      notify.success(t.hashCopied, { id: 'export-hash' });
    } catch {
      notify.error(t.hashCopyFailed, { id: 'export-hash' });
    }
  }
  return (
    <div className="flex min-w-0 items-start gap-2.5" data-testid="export-file-row">
      <FileCode aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <div className="flex min-w-0 flex-1 flex-col">
        {href ? (
          <a
            href={href}
            download={file.name}
            aria-label={linkLabel}
            className={`flex min-w-0 rounded-sm text-accent-text underline underline-offset-4 ${focusRing}`}
          >
            {name}
          </a>
        ) : (
          <span className="flex min-w-0 text-fg">{name}</span>
        )}
        <span className="flex min-w-0 items-center gap-1 text-xs text-fg-muted">
          <span className="truncate whitespace-nowrap tabular-nums" data-testid="export-file-meta">
            {fill(t.fileMeta, { size: formatFileSize(file.size), hash: shortHash(file.hash) })}
          </span>
          <Tooltip content={<span className="font-mono break-all">{file.hash}</span>}>
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={t.copyHash}
              data-testid="export-file-copy"
              data-hash={file.hash}
              className="-my-1.5 size-7 shrink-0 [&_svg]:size-3.5"
              onClick={() => void copy()}
            >
              <Copy aria-hidden />
            </IconButton>
          </Tooltip>
        </span>
      </div>
    </div>
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
  const id = useId();
  return (
    <div
      className={`relative flex min-h-12 items-start gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${checked ? 'border-success-border bg-success-subtle text-fg' : 'border-border bg-surface text-fg hover:bg-surface-hover'}`}
    >
      <Checkbox
        id={id}
        data-testid={testId}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="relative z-10 mt-0.5 data-[state=checked]:border-success data-[state=checked]:bg-success data-[state=checked]:text-success-fg"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer after:absolute after:inset-0">
        {label}
      </label>
      {checked ? <CircleCheck aria-hidden className="size-4 shrink-0 text-success-text" /> : null}
    </div>
  );
}

function Violations({
  t,
  violations,
  parts,
  onOpenPart,
}: {
  t: Text;
  violations: ExportViolation[];
  parts: readonly { id: string; name: string }[];
  onOpenPart?: ((partId: string, hole?: number) => void) | undefined;
}) {
  // T270: "Kapak · İç kesim 3" for a cut-out of a known part.
  // T270 / T275: "Kapak · İç kesim 3", "Kapak · Delik 3".
  const place = (v: ExportViolation) => itemPlace(v, parts, t, fill);
  const errors = violations.filter((v) => v.severity === 'error');
  if (errors.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-fg">{t.violationsTitle}</h3>
      <ul className="flex flex-col gap-1 text-xs" data-testid="export-violations">
        {errors.map((v, i) => (
          <li
            key={`${v.code}-${i}`}
            className="min-w-0 rounded-md border border-border-subtle bg-surface-subtle px-2.5 py-1.5 break-words"
          >
            <span className="font-medium text-danger-text">{ruleLabel(t.ruleLabels, v.rule)}</span>{' '}
            {place(v) ? (
              <span className="font-medium" data-testid="export-violation-place">
                {place(v)}:{' '}
              </span>
            ) : null}
            {v.message}
            {place(v) && v.partId !== undefined && onOpenPart ? (
              <>
                {' '}
                <button
                  type="button"
                  data-testid="export-violation-open-part"
                  onClick={() => onOpenPart(v.partId as string, v.hole)}
                  className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {t.openPart}
                </button>
              </>
            ) : null}
            {v.hole !== undefined && machineRelated(v) ? (
              <>
                {' · '}
                <Link
                  href="/makineler"
                  data-testid="export-violation-machines"
                  className="rounded-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {t.machinesLink}
                </Link>
              </>
            ) : null}
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
      <p role="alert" className="text-sm font-medium text-danger-text">
        {fill(t.exportFailed, { count: state.count })}
      </p>
    );
  }
  if (state.status !== 'done') return null;
  const files = state.record.files;
  return (
    <div
      role="status"
      data-testid="export-ready"
      className="flex flex-col gap-1 text-sm text-success-text"
    >
      <p className="font-medium">{files.length === 1 ? t.ready : t.readyMany}</p>
      <ul className="flex flex-col gap-1">
        {files.map((file) => (
          <li key={file.name}>
            <a
              href={file.downloadUrl}
              download={file.name}
              className={`rounded-sm text-accent-text underline underline-offset-4 ${focusRing}`}
            >
              {fill(t.downloadFile, { name: file.name })}
            </a>
          </li>
        ))}
        {state.record.zipUrl ? (
          <li>
            <a
              href={state.record.zipUrl}
              download
              data-testid="export-zip"
              className={`rounded-sm font-medium text-accent-text underline underline-offset-4 ${focusRing}`}
            >
              {t.zip}
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** The type of a history row (T176): NC, or the document type of a DXF / PDF record. */
export function kindLabel(t: Text, r: Pick<ExportRecord, 'kind' | 'post'>): string {
  if (r.kind === 'nc') return t.kinds.nc;
  return (t.kinds as Record<string, string>)[r.post.id] ?? r.kind.toUpperCase();
}

const historyFeatures = tableFeatures({});
const historyColumn = createColumnHelper<typeof historyFeatures, ExportRecord>();

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
  const c = t.historyColumns;
  const columns = useMemo(
    () =>
      historyColumn.columns([
        historyColumn.accessor('createdAt', {
          header: c.date,
          cell: (info) => (
            <span className="numeric whitespace-nowrap">{formatDate(info.getValue())}</span>
          ),
        }),
        historyColumn.accessor('revision', {
          header: c.revision,
          cell: (info) => fill(t.historyRevision, { n: info.getValue() }),
        }),
        historyColumn.display({
          id: 'kind',
          header: c.kind,
          cell: (info) => (
            <span className="whitespace-nowrap" data-testid="export-history-kind">
              {kindLabel(t, info.row.original)}
            </span>
          ),
        }),
        historyColumn.display({
          id: 'post',
          header: c.post,
          cell: (info) => (
            <span className="font-mono text-xs">
              {info.row.original.post.id} {info.row.original.post.version}
            </span>
          ),
        }),
        historyColumn.accessor('profileVersion', {
          header: c.profile,
          cell: (info) => {
            const v = info.getValue();
            return v === null ? '-' : fill(t.historyProfile, { n: v });
          },
        }),
        historyColumn.display({
          id: 'state',
          header: c.state,
          cell: (info) => {
            const r = info.row.original;
            return (
              <>
                {(states as Record<string, string>)[r.verification] ?? r.verification}
                {r.acceptedUnverifiedAt ? ` · ${t.historyAccepted}` : ''}
              </>
            );
          },
        }),
        historyColumn.display({
          id: 'files',
          header: c.files,
          cell: (info) => (
            <ul className="flex w-64 max-w-64 flex-col gap-2">
              {info.row.original.files.map((file) => (
                <li key={file.name} className="min-w-0">
                  <FileRow
                    t={t}
                    file={file}
                    href={file.downloadUrl}
                    linkLabel={fill(t.redownload, { name: file.name })}
                  />
                </li>
              ))}
              {info.row.original.zipUrl ? (
                <li>
                  <a
                    href={info.row.original.zipUrl}
                    download
                    data-testid="export-history-zip"
                    className={`rounded-sm text-sm text-accent-text underline underline-offset-4 ${focusRing}`}
                  >
                    {t.zip}
                  </a>
                </li>
              ) : null}
            </ul>
          ),
        }),
      ]),
    [c, t, states],
  );
  const table = useTable({
    features: historyFeatures,
    columns,
    data: rows ?? [],
    getRowId: (r) => r.exportId,
  });
  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5"
      data-testid="export-history"
    >
      <h3 className="text-sm font-semibold tracking-tight text-fg">{t.historyTitle}</h3>
      {rows === undefined ? null : rows === null ? (
        <p className="text-sm text-danger-text">{t.historyError}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-fg-muted">
          {t.historyEmpty}
        </p>
      ) : (
        <Card className="overflow-hidden p-0">
          <div
            role="region"
            aria-label={t.historyTitle}
            tabIndex={0}
            className={`overflow-x-auto ${focusRing}`}
          >
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-subtle">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className="px-3 py-2 text-xs font-medium whitespace-nowrap text-fg-muted"
                      >
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="export-history-row"
                    className="align-top transition-colors duration-(--duration-fast) hover:bg-surface-hover"
                  >
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2.5 text-fg">
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
