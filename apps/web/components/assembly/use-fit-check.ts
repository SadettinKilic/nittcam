'use client';

import { useEffect, useRef, useState } from 'react';
import type { BenchItem } from '../../lib/preview3d/assembly-model';
import { checkFit, type FitResult } from '../../lib/preview3d/fit-check';
import { fitRequest, type FitResponse } from '../../lib/preview3d/fit-check-input';

/** Wait after the last assembly edit before re-checking, ms. */
const DEBOUNCE_MS = 200;

export interface FitState {
  /** The last finished check (kept while a newer one runs). */
  result: FitResult | null;
  /** A newer check for the current items is still running. */
  busy: boolean;
  failed: boolean;
}

interface Answer {
  result: FitResult | null;
  failed: boolean;
  /** The items the answer is for. */
  items: readonly BenchItem[] | null;
}

/**
 * "Oturuyor mu?" (T388): while on, checks the visible items in a Web Worker (box test + mesh BVH)
 * after every assembly edit; stale answers are dropped. Without Worker support (tests) the box
 * test runs on the main thread.
 */
export function useFitCheck(items: readonly BenchItem[], on: boolean): FitState {
  const worker = useRef<Worker | null>(null);
  const last = useRef<{ id: number; items: readonly BenchItem[] }>({ id: 0, items: [] });
  const [answer, setAnswer] = useState<Answer>({ result: null, failed: false, items: null });

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!on) return;
    const id = last.current.id + 1;
    last.current = { id, items };
    const timer = window.setTimeout(() => {
      if (typeof Worker === 'undefined') {
        setAnswer({ result: checkFit(fitRequest(id, items).parts), failed: false, items });
        return;
      }
      if (!worker.current) {
        const w = new Worker(new URL('../../lib/preview3d/fit-check.worker.ts', import.meta.url), {
          type: 'module',
        });
        w.addEventListener('message', (e: MessageEvent<FitResponse>) => {
          if (e.data.id !== last.current.id) return;
          const forItems = last.current.items;
          setAnswer(
            e.data.ok
              ? { result: e.data.result, failed: false, items: forItems }
              : { result: null, failed: true, items: forItems },
          );
        });
        w.addEventListener('error', () =>
          setAnswer({ result: null, failed: true, items: last.current.items }),
        );
        worker.current = w;
      }
      worker.current.postMessage(fitRequest(id, items));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [items, on]);

  if (!on) return { result: null, busy: false, failed: false };
  return { result: answer.result, busy: answer.items !== items, failed: answer.failed };
}
