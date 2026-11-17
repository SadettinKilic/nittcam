import type { PostProfileVersion, Project, SimulateResult } from '@nittcam/core';

/** Main thread → simulation worker. */
export interface SimulationRequest {
  id: number;
  project: Project;
  profileVersion: PostProfileVersion;
}

/** Simulation worker → main thread. */
export type SimulationResponse =
  | { id: number; ok: true; result: SimulateResult }
  | { id: number; ok: false; error: 'unknownPost' | 'failed'; detail: string };
