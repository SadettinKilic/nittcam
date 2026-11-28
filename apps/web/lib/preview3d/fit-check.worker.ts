/**
 * Fit-check Web Worker (T388): the box test of every pair plus the exact mesh test
 * (`fit-check-bvh.ts`, three-mesh-bvh) for non-rectangular parts, off the main thread.
 */
import { checkFit } from './fit-check';
import { bvhNarrow } from './fit-check-bvh';
import type { FitRequest, FitResponse } from './fit-check-input';

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (e: MessageEvent<FitRequest>) => void): void;
  postMessage(message: FitResponse): void;
};

scope.addEventListener('message', (e) => {
  const { id, parts, meshKeys, meshes } = e.data;
  try {
    scope.postMessage({
      id,
      ok: true,
      result: checkFit(parts, bvhNarrow(parts, meshKeys, meshes)),
    });
  } catch (err) {
    scope.postMessage({ id, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
});
