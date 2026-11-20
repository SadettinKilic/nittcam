/** Wizard steps (spec §3.6), also the `?adim=` values of the URL. Shared by server pages and the client. */
export const STEPS = ['makine', 'parcalar', 'dizilim', 'simulasyon', 'export'] as const;
export type StepKey = (typeof STEPS)[number];

/** The step of a `?adim=` value; unknown or missing → step 1. */
export function toStep(v: string | string[] | undefined): StepKey {
  const s = Array.isArray(v) ? v[0] : v;
  return (STEPS as readonly string[]).includes(s ?? '') ? (s as StepKey) : 'makine';
}

/** done / current / upcoming, or blocked when the step has nothing to work on yet (T109). */
export type WizardStepStatus = 'done' | 'current' | 'upcoming' | 'blocked';

/** What the step indicator needs to know about the project. */
export interface WizardProgress {
  partCount: number;
  sheetCount: number;
}

/** Why a step cannot do anything yet (a message key), or null when it can. */
export function stepBlocker(step: StepKey, p: WizardProgress): 'noParts' | 'noLayout' | null {
  if (step === 'dizilim') return p.partCount === 0 ? 'noParts' : null;
  if (step === 'simulasyon' || step === 'export') {
    if (p.partCount === 0) return 'noParts';
    return p.sheetCount === 0 ? 'noLayout' : null;
  }
  return null;
}

/**
 * Status of each wizard step for the stepper (T109): the current one, blocked ones (no parts / no
 * layout yet; still clickable, they show their empty state), done (before the current step) and
 * upcoming. Exactly one step is current.
 */
export function wizardStepStatuses(current: StepKey, p: WizardProgress): WizardStepStatus[] {
  const at = STEPS.indexOf(current);
  return STEPS.map((s, i) => {
    if (i === at) return 'current';
    if (stepBlocker(s, p)) return 'blocked';
    return i < at ? 'done' : 'upcoming';
  });
}

/** Autosave indicator of the wizard footer (T109): Kaydedildi / Kaydediliyor / Kaydedilemedi. */
export type SaveIndicator = 'saved' | 'saving' | 'error' | 'new';

export function saveIndicator(
  state: 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict',
  saved: boolean,
): SaveIndicator {
  if (state === 'error' || state === 'conflict') return 'error';
  if (state === 'pending' || state === 'saving') return 'saving';
  if (state === 'idle' && !saved) return 'new';
  return 'saved';
}

/**
 * The step a saved project opens on when the URL names none (T290, D-063): the export step once
 * it was exported, Dizilim once it has a layout, otherwise Parçalar (the machine step only by
 * `?adim=makine`).
 */
export function resumeStep(p: WizardProgress & { exported: boolean }): StepKey {
  if (p.exported && p.partCount > 0 && p.sheetCount > 0) return 'export';
  if (p.partCount > 0 && p.sheetCount > 0) return 'dizilim';
  return 'parcalar';
}

/** localStorage key of a saved project's Parçalar view (T290: Liste / Çizim remembered). */
export function partsViewKey(projectId: string): string {
  return `nittcam.partsView.${projectId}`;
}
