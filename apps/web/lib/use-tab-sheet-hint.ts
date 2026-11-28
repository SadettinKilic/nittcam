'use client';

import type { LayoutSummary, Project, RunNestingParams } from '@nittcam/core';
import { useEffect, useMemo, useState } from 'react';
import { optionSetKey } from './nesting-cache';
import type { NestingRequest, NestingWorkerMessage } from './nesting-messages';
import { tabSheetProbe, tabSheetSaving } from './tab-sheet-hint';

/**
 * T428: runs the thin-skin probe (`tabSheetProbe`) in its own short-lived worker, so the page's
 * nesting worker (and a "Diz" the user starts) never waits for it. Once per option set; the
 * answer is the sheet count with thin skin when it saves a sheet, else null.
 */
export function useTabSheetHint(
  project: Project,
  params: RunNestingParams,
  toolDiameter: number,
  summary: LayoutSummary | undefined,
  running: boolean,
): number | null {
  const probe = useMemo(
    () => (running ? null : tabSheetProbe(project, toolDiameter, summary)),
    [project, toolDiameter, summary, running],
  );
  const key = useMemo(() => (probe ? optionSetKey(probe, params) : null), [probe, params]);
  const [answer, setAnswer] = useState<{ key: string; probe: LayoutSummary | undefined } | null>(
    null,
  );
  const known = answer !== null && answer.key === key;
  useEffect(() => {
    if (!probe || !key || known || typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<NestingWorkerMessage>) => {
      const m = e.data;
      if (m.kind === 'progress') return;
      setAnswer({ key, probe: m.ok ? m.summary : undefined });
      worker.terminate();
    });
    const request: NestingRequest = { id: 1, project: probe, params };
    worker.postMessage(request);
    return () => worker.terminate();
  }, [probe, key, known, params]);
  if (!summary || !known) return null;
  return tabSheetSaving(summary, answer.probe);
}
