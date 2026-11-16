/**
 * Nesting Web Worker (spec §8.2 "Ağır iş arayüzü kilitlemez"). Runs the core `runNesting` command on
 * a copy of the project off the main thread and returns its params and patches; the page records
 * them with `CommandStack.executeApplied`, so the placer runs once.
 */
import { applyCommand, summarizeLayout } from '@nittcam/core';
import type { NestingRequest, NestingResponse } from './nesting-messages';

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (e: MessageEvent<NestingRequest>) => void): void;
  postMessage(message: NestingResponse): void;
};

scope.addEventListener('message', (e) => {
  const { id, project, toolDiameter } = e.data;
  try {
    const result = applyCommand(project, 'runNesting', { toolDiameter });
    if (!result.ok) {
      scope.postMessage({ id, ok: false, error: result.error.message });
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
