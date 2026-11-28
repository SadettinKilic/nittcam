'use client';

import type { LayoutSummary, Project, RunNestingParams } from '@nittcam/core';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  // The effect keys on the option-set string only: `probe` and `params` get a new identity on
  // many renders, and restarting on each one terminated the worker while its script was still
  // loading (the request never finished, the page never reached network idle).
  const latest = useRef({ probe, params });
  // Runs before the worker effect below (effects run in order), so it always sees the latest pair.
  useEffect(() => {
    latest.current = { probe, params };
  });
  useEffect(() => {
    const { probe: p, params: prm } = latest.current;
    if (!p || !key || known || typeof Worker === 'undefined') return;
    let worker: Worker | null = null;
    const start = setTimeout(() => {
      const w = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' });
      worker = w;
      w.addEventListener('message', (e: MessageEvent<NestingWorkerMessage>) => {
        const m = e.data;
        if (m.kind === 'progress') return;
        setAnswer({ key, probe: m.ok ? m.summary : undefined });
        w.terminate();
        worker = null;
      });
      const request: NestingRequest = { id: 1, project: p, params: prm };
      w.postMessage(request);
    }, 400);
    return () => {
      clearTimeout(start);
      worker?.terminate();
    };
  }, [key, known]);
  if (!summary || !known) return null;
  return tabSheetSaving(summary, answer.probe);
}
