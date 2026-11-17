/** Wizard steps (spec §3.6), also the `?adim=` values of the URL. Shared by server pages and the client. */
export const STEPS = ['makine', 'parcalar', 'dizilim', 'simulasyon', 'export'] as const;
export type StepKey = (typeof STEPS)[number];

/** The step of a `?adim=` value; unknown or missing → step 1. */
export function toStep(v: string | string[] | undefined): StepKey {
  const s = Array.isArray(v) ? v[0] : v;
  return (STEPS as readonly string[]).includes(s ?? '') ? (s as StepKey) : 'makine';
}
