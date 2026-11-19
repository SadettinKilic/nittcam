import type { PostProfileVersion, Project, SimulateResult } from '@nittcam/core';

/** Main thread → simulation worker. */
export interface SimulationRequest {
  id: number;
  project: Project;
  profileVersion: PostProfileVersion;
  /** Header and file name: the same values the export writes (T262). */
  meta: SimulationMeta;
}

/** Project name and saved revision for the program header and file name (T262). */
export interface SimulationMeta {
  projectName: string;
  revision: number;
}

/** Simulation worker → main thread. */
export type SimulationResponse =
  | { id: number; ok: true; result: SimulateResult }
  | { id: number; ok: false; error: 'unknownPost' | 'failed'; detail: string };
