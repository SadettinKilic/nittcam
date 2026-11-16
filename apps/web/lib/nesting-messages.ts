import type { AppliedCommand, LayoutSummary, Project } from '@nittcam/core';

/** Main thread → nesting worker. */
export interface NestingRequest {
  id: number;
  project: Project;
  toolDiameter: number;
}

/** Nesting worker → main thread. */
export type NestingResponse =
  | {
      id: number;
      ok: true;
      applied: Pick<AppliedCommand, 'params' | 'patches' | 'inversePatches'>;
      summary: LayoutSummary;
    }
  | { id: number; ok: false; error: string };
