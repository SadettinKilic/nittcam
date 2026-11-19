import { describe, expect, it } from 'vitest';
import tr from '../../messages/tr.json';
import {
  EDITOR_TOUR,
  EDITOR_TOUR_KEY,
  rememberTourDone,
  shouldAutoStartTour,
  tourMove,
  type TourStorage,
} from './tour';

function memory(): TourStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('editor tour (T136)', () => {
  it('has five steps, each with a title and body in Turkish', () => {
    expect(EDITOR_TOUR).toHaveLength(5);
    for (const step of EDITOR_TOUR) {
      expect(tr.editor.tour.steps[step.id].title, step.id).toBeTruthy();
      expect(tr.editor.tour.steps[step.id].body, step.id).toBeTruthy();
    }
  });

  it('starts once: remembered after finish or skip', () => {
    const s = memory();
    expect(shouldAutoStartTour(() => s)).toBe(true);
    rememberTourDone(() => s);
    expect(s.data.get(EDITOR_TOUR_KEY)).toBe('done');
    expect(shouldAutoStartTour(() => s)).toBe(false);
  });

  it('never starts when storage is blocked, and remembering does not throw', () => {
    const boom = (): TourStorage => {
      throw new Error('SecurityError');
    };
    expect(shouldAutoStartTour(boom)).toBe(false);
    expect(shouldAutoStartTour(() => null)).toBe(false);
    expect(() => rememberTourDone(boom)).not.toThrow();
    const getThrows: TourStorage = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {},
    };
    expect(shouldAutoStartTour(() => getThrows)).toBe(false);
  });

  it('moves next/back within bounds and closes after the last step', () => {
    expect(tourMove(0, 'back')).toBe(0);
    expect(tourMove(0, 'next')).toBe(1);
    expect(tourMove(3, 'next')).toBe(4);
    expect(tourMove(4, 'next')).toBeNull();
    expect(tourMove(2, 'back')).toBe(1);
    expect(tourMove(2, 'close')).toBeNull();
  });
});
