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
  notify,
} from '@nittcam/ui';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { fill } from '../../lib/draft-project';
import {
  reexportUrl,
  type ExportApiError,
  type ExportRecord,
  type ExportResponse,
} from '../../lib/exports-api';
import type { Messages } from '../../lib/messages';

type Text = Messages['wizard']['export'];

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
 */
export function ReexportButton({
  t,
  record,
  label,
  onDone,
}: {
  t: Text;
  record: ExportRecord;
  /** Type name for the accessible label ("NC", "PDF A4", ...). */
  label: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  async function run(accept: boolean) {
    setBusy(true);
    try {
      const res = await fetch(reexportUrl(record.exportId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(accept ? { acceptUnverified: true } : {}),
      });
      if (res.status === 428) {
        setAsking(true);
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
      const message =
        body?.error === 'export_failed'
          ? fill(t.reexportFailed, { count: Math.max(1, body.violations.length) })
          : body?.error === 'snapshot_missing'
            ? t.reexportMissing
            : t.reexportError;
      notify.error(message, { id: 'export-reexport' });
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
        // Unverified NC files: ask for the acceptance first (the server would answer 428).
        onClick={() => (record.unverified ? setAsking(true) : void run(false))}
      >
        <RotateCcw aria-hidden />
        {busy ? t.reexportBusy : t.reexport}
      </Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent data-testid="export-reexport-accept">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.unverifiedTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.unverifiedBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm font-medium text-fg">{t.accept}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.reexportCancel}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="export-reexport-confirm"
              onClick={() => {
                setAsking(false);
                void run(true);
              }}
            >
              {t.reexportAcceptConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
