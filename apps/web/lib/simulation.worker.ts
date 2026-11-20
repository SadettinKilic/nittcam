/**
 * Simulation Web Worker (spec §6.5, §8.2 "Ağır iş arayüzü kilitlemez"; T020, D-028). Generates
 * the G-code with `exportNc` (toolpath → post → automatic checks), reads it back with the
 * independent reader and builds the playback steps, all off the main thread.
 */
import { simulateProject } from '@nittcam/core';
import { POST_CONFIGS } from '@nittcam/machines';
import { ncNameOptions } from './file-names';
import type { SimulationRequest, SimulationResponse } from './simulation-messages';

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (e: MessageEvent<SimulationRequest>) => void): void;
  postMessage(message: SimulationResponse): void;
};

scope.addEventListener('message', (e) => {
  const { id, project, profileVersion, meta } = e.data;
  try {
    const postId = profileVersion.profile.post.id;
    const post = POST_CONFIGS[postId];
    if (post === undefined) {
      scope.postMessage({ id, ok: false, error: 'unknownPost', detail: postId });
      return;
    }
    const result = simulateProject(
      project,
      profileVersion,
      post,
      ncNameOptions(meta.projectName, meta.revision),
    );
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    scope.postMessage({
      id,
      ok: false,
      error: 'failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});
