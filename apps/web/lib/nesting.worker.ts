/**
 * Nesting Web Worker (spec §8.2 "Ağır iş arayüzü kilitlemez"). Runs `runNesting` on a copy of the
 * project off the main thread, reports progress after every placer candidate (T163) and returns
 * the command's params and patches; the page records them with `CommandStack.executeApplied`, so
 * the placer runs once. "İptal" terminates the worker: nothing is recorded.
 */
import { runNestingWithProgress, summarizeLayout } from '@nittcam/core';
import type { NestingRequest, NestingWorkerMessage } from './nesting-messages';

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (e: MessageEvent<NestingRequest>) => void): void;
  postMessage(message: NestingWorkerMessage): void;
};

scope.addEventListener('message', (e) => {
  const { id, project, params } = e.data;
  try {
    const result = runNestingWithProgress(project, params, {
      onProgress: (done, total) => scope.postMessage({ id, kind: 'progress', done, total }),
    });
    if (!result.ok) {
      scope.postMessage({ id, ok: false, error: result.error });
      return;
    }
    scope.postMessage({
      id,
      ok: true,
      applied: {
        params: result.params,
        patches: result.patches,
        inversePatches: result.inversePatches,
      },
      summary: summarizeLayout(result.project),
    });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
