'use client';

import {
  MAINTENANCE_INTERVAL_MAX,
  MAINTENANCE_NOTE_MAX,
  latestMaintenance,
  maintenanceEntrySchema,
  type MaintenanceEntry,
} from '@nittcam/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  NumberInput,
  Skeleton,
  Textarea,
} from '@nittcam/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { MaintenanceBadge } from '../../components/machines/maintenance-badge';
import { fill } from '../../lib/draft-project';
import type { MachineListItem } from '../../lib/machines-api';
import { formatDay, localDay, maintenanceView } from '../../lib/maintenance';
import type { Messages } from '../../lib/messages';

type Text = Messages['machines']['maintenance'];

/** Interval a first entry suggests: every 90 days. */
const DEFAULT_INTERVAL = 90;

/**
 * "Bakım" (T181, spec §3.4 manuel bakım kaydı): the reminder state, a new entry (date, interval
 * days, note) and the history, newest first. `onSaved` gets the newest entry after a save.
 */
export function MaintenanceDialog({
  t,
  machine,
  onClose,
  onSaved,
}: {
  t: Text;
  machine: MachineListItem;
  onClose: () => void;
  onSaved: (latest: MaintenanceEntry | null) => void;
}) {
  const today = localDay();
  const [log, setLog] = useState<MaintenanceEntry[] | null | 'error'>(null);
  const [date, setDate] = useState(today);
  const [intervalDays, setIntervalDays] = useState<number | null>(
    machine.maintenance?.intervalDays ?? DEFAULT_INTERVAL,
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/machines/${machine.id}/maintenance`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { log: MaintenanceEntry[] };
        if (live) setLog(body.log);
      })
      .catch(() => live && setLog('error'));
    return () => {
      live = false;
    };
  }, [machine.id]);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const entry = maintenanceEntrySchema.safeParse({ date, intervalDays, note });
    if (!entry.success) return setMessage(t.invalid);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/machines/${machine.id}/maintenance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry.data),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { log: MaintenanceEntry[] };
      setLog(body.log);
      setNote('');
      onSaved(latestMaintenance(body.log));
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  }

  const view = maintenanceView(
    Array.isArray(log) ? latestMaintenance(log) : machine.maintenance,
    today,
    t,
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-lg" data-testid="maintenance-dialog">
        <form onSubmit={(ev) => void save(ev)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{fill(t.title, { name: machine.name })}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <MaintenanceBadge view={view} data-testid="maintenance-dialog-status" />
            {view.detail ? <span>{view.detail}</span> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t.date}>
              <Input
                type="date"
                data-testid="maintenance-date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </FormField>
            <FormField label={t.interval}>
              <NumberInput
                data-testid="maintenance-interval"
                value={intervalDays}
                onValueChange={setIntervalDays}
                min={1}
                max={MAINTENANCE_INTERVAL_MAX}
                step={1}
                unit={t.intervalUnit}
                required
              />
            </FormField>
            <FormField label={t.note} className="sm:col-span-2">
              <Textarea
                data-testid="maintenance-note"
                value={note}
                maxLength={MAINTENANCE_NOTE_MAX}
                placeholder={t.notePlaceholder}
                rows={2}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
          </div>
          {message ? (
            <p role="alert" className="text-sm text-danger-text" data-testid="maintenance-message">
              {message}
            </p>
          ) : null}
          <section aria-labelledby="maintenance-history" className="flex flex-col gap-2">
            <h3 id="maintenance-history" className="text-sm font-medium text-fg">
              {t.history}
            </h3>
            {log === null ? (
              <Skeleton className="h-10 w-full" />
            ) : log === 'error' ? (
              <p className="text-sm text-danger-text">{t.loadError}</p>
            ) : log.length === 0 ? (
              <p className="text-sm text-fg-muted">{t.historyEmpty}</p>
            ) : (
              <ul
                data-testid="maintenance-history"
                className="flex max-h-48 flex-col divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle"
              >
                {[...log].reverse().map((e, i) => (
                  <li key={`${e.date}-${i}`} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                    <span className="flex flex-wrap gap-x-2">
                      <span className="numeric font-medium text-fg">{formatDay(e.date)}</span>
                      <span className="text-fg-muted">
                        {fill(t.entry, { interval: e.intervalDays })}
                      </span>
                    </span>
                    {e.note ? <span className="text-fg-muted">{e.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" loading={busy} disabled={busy} data-testid="maintenance-save">
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
