import { describe, expect, it } from 'vitest';
import { getMessages } from './messages';
import {
  ONBOARDING_KEY,
  onboardingMessages,
  rememberOnboardingDone,
  shouldOpenOnboarding,
  type OnboardingStorage,
} from './onboarding';
import { STEPS } from './wizard-steps';

const tr = getMessages();

function memory(
  initial: Record<string, string> = {},
): OnboardingStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const broken: OnboardingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('onboarding first-run state (T184, D-075)', () => {
  it('opens on the first visit only', () => {
    const s = memory();
    expect(shouldOpenOnboarding(() => s, false)).toBe(true);
    rememberOnboardingDone(() => s);
    expect(s.data[ONBOARDING_KEY]).toBe('done');
    expect(shouldOpenOnboarding(() => s, false)).toBe(false);
  });

  it('reopens on request even after it was seen', () => {
    const s = memory({ [ONBOARDING_KEY]: 'done' });
    expect(shouldOpenOnboarding(() => s, true)).toBe(true);
  });

  it('blocked or missing storage never opens it by itself and never throws', () => {
    expect(shouldOpenOnboarding(() => broken, false)).toBe(false);
    expect(shouldOpenOnboarding(() => null, false)).toBe(false);
    expect(
      shouldOpenOnboarding(() => {
        throw new Error('denied');
      }, false),
    ).toBe(false);
    expect(() => rememberOnboardingDone(() => broken)).not.toThrow();
  });

  it('has a line for each of the five wizard steps', () => {
    const m = onboardingMessages(tr);
    for (const s of STEPS) {
      expect(m.stepNames[s]).toBeTruthy();
      expect(m.onboarding.steps.items[s]).toBeTruthy();
    }
    expect(m.onboarding.sampleName.startsWith('Örnek: ')).toBe(true);
  });
});
