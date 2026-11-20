'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  notify,
} from '@nittcam/ui';
import { RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { fill } from '../../lib/draft-project';
import { EMPTY_CHECKLIST, downloadBlocker, type ChecklistState } from '../../lib/export-gate';
import {
  reexportUrl,
  type ExportApiError,
  type ExportRecord,
  type ExportResponse,
  type ReexportChecklistRequired,
} from '../../lib/exports-api';
import type { Messages } from '../../lib/messages';
import { ExportChecklist } from './export-checklist';

type Text = Messages['wizard']['export'];
type Corners = Messages['machines']['form']['options']['corner'];

function startDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * "Yeniden üret" of a history row (T179, spec §3.4): the server regenerates the export from the
 * revision it was made from (D-066) and goes through every NC check again. Unverified NC files need
 * the same acceptance as the export step (§7.2 rule 10), asked in a dialog. The same bytes return
 * the same record; a changed machine verification state adds a new record (E6).
 * D-071: an NC re-export asks the export step's whole checklist (origin, tools, tool changes,
 * templates, air cut) in that dialog first; the server refuses it (428) until it is confirmed.
 */
export function ReexportButton({
  t,
  corners,
  record,
  label,
  onDone,
}: {
  t: Text;
  corners: Corners;
  record: ExportRecord;
  /** Type name for the accessible label ("NC", "PDF A4", ...). */
  label: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // The NC dialog: what the server asked for, and the operator's ticks.
  const [ask, setAsk] = useState<ReexportChecklistRequired | null>(null);
  const [checks, setChecks] = useState<ChecklistState>(EMPTY_CHECKLIST);
  const [accepted, setAccepted] = useState(false);
  const acceptId = useId();

  function open(next: ReexportChecklistRequired) {
    setChecks(EMPTY_CHECKLIST);
    setAccepted(false);
    setAsk(next);
  }

  /** GET the regenerated program's checklist (nothing is stored) and open the dialog. */
  async function askChecklist() {
    setBusy(true);
    try {
      const res = await fetch(reexportUrl(record.exportId), { cache: 'no-store' });
      if (res.ok) {
        open((await res.json()) as ReexportChecklistRequired);
        return;
      }
      const body = (await res.json().catch(() => null)) as ExportApiError | null;
      notify.error(errorText(body), { id: 'export-reexport' });
    } catch {
      notify.error(t.reexportError, { id: 'export-reexport' });
    } finally {
      setBusy(false);
    }
  }

  function errorText(body: ExportApiError | null): string {
    return body?.error === 'export_failed'
      ? fill(t.reexportFailed, { count: Math.max(1, body.violations.length) })
      : body?.error === 'snapshot_missing'
        ? t.reexportMissing
        : t.reexportError;
  }

  async function run(confirm: { checklist: boolean; accept: boolean }) {
    setBusy(true);
    try {
      const res = await fetch(reexportUrl(record.exportId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(confirm.checklist ? { checklistConfirmed: true } : {}),
          ...(confirm.accept ? { acceptUnverified: true } : {}),
        }),
      });
      if (res.status === 428) {
        const body = (await res.json().catch(() => null)) as ExportApiError | null;
        open(
          body?.error === 'checklist_required'
            ? body
            : {
                error: 'checklist_required',
                checklist: ask?.checklist ?? null,
                needsAcceptance: true,
                templates: ask?.templates ?? [],
                hingeHandles: ask?.hingeHandles ?? [],
              },
        );
        return;
      }
      if (res.ok) {
        const out = (await res.json()) as ExportResponse;
        const only = out.files.length === 1 ? out.files[0] : undefined;
        if (only) startDownload(only.downloadUrl, only.name);
        else if (out.zipUrl) startDownload(out.zipUrl, '');
        notify.success(
          out.stateChanged ? t.reexportStateChanged : out.created ? t.reexportNew : t.reexportSame,
          { id: 'export-reexport' },
        );
        onDone();
        return;
      }
      const body = (await res.json().catch(() => null)) as ExportApiError | null;
      notify.error(errorText(body), { id: 'export-reexport' });
    } catch {
      notify.error(t.reexportError, { id: 'export-reexport' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        aria-busy={busy}
        aria-label={fill(t.reexportLabel, { kind: label, n: record.revision })}
        data-testid="export-reexport"
        // NC: the dialog asks the checklist first (D-071); documents regenerate at once.
        onClick={() =>
          void (record.kind === 'nc' ? askChecklist() : run({ checklist: false, accept: false }))
        }
      >
        <RotateCcw aria-hidden />
        {busy ? t.reexportBusy : t.reexport}
      </Button>
      <AlertDialog open={ask !== null} onOpenChange={(o) => (o ? undefined : setAsk(null))}>
        <AlertDialogContent data-testid="export-reexport-accept" className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {fill(t.reexportChecklistTitle, { n: record.revision })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t.reexportChecklistBody}</AlertDialogDescription>
          </AlertDialogHeader>
          {ask ? (
            <ExportChecklist
              t={t}
              corners={corners}
              checklist={ask.checklist}
              templateNames={ask.templates}
              hingeHandleParts={ask.hingeHandles}
              checks={checks}
              onChange={setChecks}
              testIdPrefix="reexport"
            />
          ) : null}
          {ask?.needsAcceptance ? (
            <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-sm">
              <p className="font-semibold text-fg">{t.unverifiedTitle}</p>
              <p className="text-fg-muted">{t.unverifiedBody}</p>
              <div className="flex items-start gap-2.5 font-medium text-fg">
                <Checkbox
                  id={acceptId}
                  data-testid="reexport-accept"
                  checked={accepted}
                  onCheckedChange={(v) => setAccepted(v === true)}
                  className="mt-0.5 data-[state=checked]:border-warning data-[state=checked]:bg-warning data-[state=checked]:text-warning-fg"
                />
                <label htmlFor={acceptId} className="cursor-pointer">
                  {t.accept}
                </label>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t.reexportCancel}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="export-reexport-confirm"
              disabled={
                !ask ||
                downloadBlocker(
                  {
                    ok: true,
                    files: [{}] as never[],
                    needsAcceptance: ask.needsAcceptance,
                    checklist: ask.checklist,
                  },
                  checks,
                  accepted,
                  ask.templates.length,
                ) !== null
              }
              onClick={() => {
                const needs = ask?.needsAcceptance ?? false;
                setAsk(null);
                void run({ checklist: true, accept: needs && accepted });
              }}
            >
              {ask?.needsAcceptance ? t.reexportAcceptConfirm : t.reexportConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
