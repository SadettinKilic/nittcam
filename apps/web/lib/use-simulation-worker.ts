'use client';

import type { PostProfileVersion, Project } from '@nittcam/core';
import { useCallback, useEffect, useRef } from 'react';
import type { SimulationMeta, SimulationRequest, SimulationResponse } from './simulation-messages';

/**
 * Runs the simulation pipeline in a Web Worker (spec §8.2). The worker is created on first use and
 * terminated on unmount. Each call resolves with the worker's response for that request.
 */
export function useSimulationWorker(): (
  project: Project,
  profileVersion: PostProfileVersion,
  meta: SimulationMeta,
) => Promise<SimulationResponse> {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (r: SimulationResponse) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    const waiting = pending.current;
    return () => {
      worker.current?.terminate();
      worker.current = null;
      for (const [id, resolve] of waiting) {
        resolve({ id, ok: false, error: 'failed', detail: 'terminated' });
      }
      waiting.clear();
    };
  }, []);

  return useCallback((project, profileVersion, meta) => {
    if (!worker.current) {
      const w = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
      w.addEventListener('message', (e: MessageEvent<SimulationResponse>) => {
        const resolve = pending.current.get(e.data.id);
        pending.current.delete(e.data.id);
        resolve?.(e.data);
      });
      w.addEventListener('error', (e) => {
        for (const [id, resolve] of pending.current) {
          resolve({ id, ok: false, error: 'failed', detail: e.message || 'worker error' });
        }
        pending.current.clear();
      });
      worker.current = w;
    }
    const id = nextId.current++;
    const request: SimulationRequest = { id, project, profileVersion, meta };
    return new Promise<SimulationResponse>((resolve) => {
      pending.current.set(id, resolve);
      worker.current?.postMessage(request);
    });
  }, []);
}
