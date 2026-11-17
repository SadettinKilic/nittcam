'use client';

import type { Project } from '@nittcam/core';
import { useEffect, useMemo, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import type { SimulationResponse } from '../../lib/simulation-messages';
import { useSimulationWorker } from '../../lib/use-simulation-worker';
import { findings } from '../simulation/violations';
import type { SimMachine } from '../simulation/simulation-view';

type Text = Messages['wizard']['export'];

/**
 * Step 5 "Dışa aktar" until T021 (spec §3.6 step 5, §7.2 rule 9): runs the same export pipeline
 * and automatic checks as the simulation (in the worker) and shows the result. The download stays
 * disabled: T021 regenerates the file on the server from the saved revision (§8.2 "sunucu
 * yetkilidir"), so nothing is faked here.
 */
export function ExportStep({
  t,
  project,
  machine,
  revision,
  saved,
}: {
  t: Text;
  project: Project;
  machine: SimMachine | null;
  revision: number;
  /** False while changes wait for the autosave. */
  saved: boolean;
}) {
  const simulate = useSimulationWorker();
  const [run, setRun] = useState<{ project: Project; key: string; res: SimulationResponse } | null>(
    null,
  );
  const hasLayout = project.layout.sheets.length > 0;
  const key = machine ? `${machine.id}@${machine.pv.version}` : '';

  useEffect(() => {
    if (!hasLayout || !machine) return;
    let live = true;
    void simulate(project, machine.pv).then((res) => {
      if (live) setRun({ project, key, res });
    });
    return () => {
      live = false;
    };
  }, [project, machine, key, hasLayout, simulate]);

  const res = run && run.project === project && run.key === key ? run.res : null;
  const errors = useMemo(
    () => (res?.ok ? findings(res.result).filter((f) => f.severity === 'error').length : 0),
    [res],
  );

  let status: React.ReactNode;
  if (!machine) status = <p className="text-sm text-fg-muted">{t.noMachine}</p>;
  else if (!hasLayout) status = <p className="text-sm text-fg-muted">{t.noLayout}</p>;
  else if (!res) {
    status = (
      <p
        role="status"
        data-testid="export-checking"
        className="flex items-center gap-2 text-sm text-fg-muted"
      >
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-border border-t-accent"
        />
        {t.checking}
      </p>
    );
  } else if (!res.ok) {
    status = (
      <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
        {fill(t.failedRun, { error: res.detail })}
      </p>
    );
  } else if (res.result.ok && errors === 0) {
    const files = res.result.export.fileNames.length;
    status = (
      <div className="flex flex-col gap-1">
        <p
          data-testid="export-status"
          data-ok="true"
          className="rounded-lg bg-ok-bg p-3 text-sm font-semibold text-ok"
        >
          <span aria-hidden="true">✓ </span>
          {t.passed}
        </p>
        <p className="text-xs text-fg-muted">
          {fill(t.files, { files, sheets: res.result.sheets.length })}
        </p>
      </div>
    );
  } else {
    status = (
      <p
        data-testid="export-status"
        data-ok="false"
        role="alert"
        className="rounded-lg bg-danger-bg p-3 text-sm text-danger"
      >
        {fill(t.failed, { count: Math.max(1, errors) })}
      </p>
    );
  }

  return (
    <>
      <aside className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-4">
        <h2 className="text-base font-semibold">{t.checks}</h2>
        {status}
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
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            disabled
            aria-describedby="export-pending"
            data-testid="export-download"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.download}
          </button>
          <p id="export-pending" data-testid="export-pending" className="text-sm text-info">
            {t.pending}
          </p>
        </div>
      </section>
    </>
  );
}
