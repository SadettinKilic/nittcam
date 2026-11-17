/**
 * 2D simulation from the read G-code (spec §6.5, T020, D-028): build and playback model.
 */
export * from './types';
export { buildSimSheet, splitGcodeLines, SIM_CHORD_TOLERANCE } from './build';
export type { SimSheetInput } from './build';
export {
  SIM_TIME_EPS,
  clampSimTime,
  simPlayheadAt,
  nextStepTime,
  prevStepTime,
  timeForLine,
  lineAt,
  positionAt,
  playbackRate,
} from './playback';
export type { SimPlayhead } from './playback';
export { simulateProject, simMachineFrame, SIM_DEFAULT_RAPID_FEED } from './simulate';
export type { SimulateResult } from './simulate';
