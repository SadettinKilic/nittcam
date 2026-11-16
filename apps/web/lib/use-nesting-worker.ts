'use client';

import type { Project } from '@nittcam/core';
import { useCallback, useEffect, useRef } from 'react';
import type { NestingRequest, NestingResponse } from './nesting-messages';

/**
 * Runs nesting in a Web Worker (spec §8.2). The worker is created on first use and terminated on
 * unmount. Each call resolves with the worker's response for that request.
 */
export function useNestingWorker(): (
  project: Project,
  toolDiameter: number,
) => Promise<NestingResponse> {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (r: NestingResponse) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    const waiting = pending.current;
    return () => {
      worker.current?.terminate();
      worker.current = null;
      for (const [id, resolve] of waiting) resolve({ id, ok: false, error: 'terminated' });
      waiting.clear();
    };
  }, []);

  return useCallback((project, toolDiameter) => {
    if (!worker.current) {
      const w = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' });
      w.addEventListener('message', (e: MessageEvent<NestingResponse>) => {
        const resolve = pending.current.get(e.data.id);
        pending.current.delete(e.data.id);
        resolve?.(e.data);
      });
      w.addEventListener('error', (e) => {
        for (const [id, resolve] of pending.current) {
          resolve({ id, ok: false, error: e.message || 'worker error' });
        }
        pending.current.clear();
      });
      worker.current = w;
    }
    const id = nextId.current++;
    const request: NestingRequest = { id, project, toolDiameter };
    return new Promise<NestingResponse>((resolve) => {
      pending.current.set(id, resolve);
      worker.current?.postMessage(request);
    });
  }, []);
}
