// First-run onboarding (T184, spec §4.2 "İlk kullanımda kısa tanıtım turu", D-075): a short
// welcome dialog on Ana sayfa, remembered per browser in localStorage (accounts come in M10).
// Pure helpers; the dialog is components/home/onboarding-dialog.tsx.

import type { Messages } from './messages';

/** localStorage key; the value `done` means the tour was finished or skipped. */
export const ONBOARDING_KEY = 'nittcam-onboarding';

/** `/?tanitim=1` opens the tour again (Ayarlar "Tanıtımı yeniden aç"). */
export const ONBOARDING_PARAM = 'tanitim';
export const ONBOARDING_REOPEN_HREF = `/?${ONBOARDING_PARAM}=1`;

/** The tour's pages: welcome, the five wizard steps, how to start. */
export const ONBOARDING_PAGES = ['welcome', 'steps', 'start'] as const;
export type OnboardingPage = (typeof ONBOARDING_PAGES)[number];

export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null where it cannot be read (private mode, policy). */
export function browserStorage(): OnboardingStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Should the tour open on this visit? Always when asked for (`reopen`); by itself only when
 * storage works and the tour was never finished or skipped. Blocked storage never opens it by
 * itself: it could not be remembered and would come back on every visit.
 */
export function shouldOpenOnboarding(
  storage: () => OnboardingStorage | null,
  reopen: boolean,
): boolean {
  if (reopen) return true;
  try {
    const s = storage();
    return s !== null && s.getItem(ONBOARDING_KEY) !== 'done';
  } catch {
    return false;
  }
}

/** Remembers that the tour was finished or skipped; storage errors are ignored. */
export function rememberOnboardingDone(storage: () => OnboardingStorage | null): void {
  try {
    storage()?.setItem(ONBOARDING_KEY, 'done');
  } catch {
    /* storage blocked: nothing to remember */
  }
}

/** The text the tour needs (a small slice of the messages, so the page does not ship them all). */
export interface OnboardingMessages {
  onboarding: Messages['onboarding'];
  stepNames: Messages['wizard']['steps'];
  roles: Messages['cutList']['cabinet']['roles'];
}

/** Picks the tour's text out of the messages (server side). */
export function onboardingMessages(m: Messages): OnboardingMessages {
  return { onboarding: m.onboarding, stepNames: m.wizard.steps, roles: m.cutList.cabinet.roles };
}
