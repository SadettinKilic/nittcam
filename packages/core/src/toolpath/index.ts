/** Toolpath model and builder (spec §6.3, T014, D-021). Pure code. */
export * from './types';
export * from './depth';
export {
  buildToolpath,
  placedOutline,
  outerContourPath,
  innerContourPath,
  TOOLPATH_DEFAULTS,
} from './build';
export type { ContourPathResult } from './build';
export { toolpathSafetyViolations, operationMoves, toolpathMoves } from './safety';
export { summarizeToolpath, moveLength } from './stats';
