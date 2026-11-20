import type {
  AppliedCommand,
  LayoutSummary,
  ObjectiveCost,
  Project,
  RunNestingParams,
} from '@nittcam/core';

/** Main thread → nesting worker. */
export interface NestingRequest {
  id: number;
  project: Project;
  params: RunNestingParams;
}

/** Nesting worker → main thread: progress while the placer runs (T163). */
export interface NestingProgress {
  id: number;
  kind: 'progress';
  /** Candidates tried so far and in total. */
  done: number;
  total: number;
}

/** Nesting worker → main thread: the final answer of a request. */
export type NestingResponse =
  | {
      id: number;
      ok: true;
      applied: Pick<AppliedCommand, 'params' | 'patches' | 'inversePatches'>;
      summary: LayoutSummary;
      /** Objective terms of the layout (B44 mode cards). */
      cost?: ObjectiveCost;
    }
  | { id: number; ok: false; error: string };

export type NestingWorkerMessage = NestingProgress | (NestingResponse & { kind?: undefined });
