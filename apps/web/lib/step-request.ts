/**
 * In-project step commands of the command palette (P4, CTO #10): the palette lives in the shell,
 * the step state in the wizard, so the palette asks with a window event and the open wizard goes.
 */
import type { StepKey } from './wizard-steps';

export const STEP_REQUEST_EVENT = 'nittcam:step-request';

export function requestStep(step: StepKey): void {
  window.dispatchEvent(new CustomEvent<StepKey>(STEP_REQUEST_EVENT, { detail: step }));
}
