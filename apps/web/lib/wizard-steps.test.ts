import { describe, expect, it } from 'vitest';
import { STEPS, saveIndicator, stepBlocker, toStep, wizardStepStatuses } from './wizard-steps';

describe('wizard step statuses (T109)', () => {
  it('blocks layout without parts and simulation/export without a layout', () => {
    const empty = { partCount: 0, sheetCount: 0 };
    expect(wizardStepStatuses('makine', empty)).toEqual([
      'current',
      'upcoming',
      'blocked',
      'blocked',
      'blocked',
    ]);
    expect(stepBlocker('dizilim', empty)).toBe('noParts');
    expect(stepBlocker('export', { partCount: 3, sheetCount: 0 })).toBe('noLayout');
    expect(stepBlocker('makine', empty)).toBeNull();
  });

  it('marks earlier steps done and later ones upcoming once a layout exists', () => {
    const ready = { partCount: 4, sheetCount: 2 };
    expect(wizardStepStatuses('dizilim', ready)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
    ]);
  });

  it('always has exactly one current step, the given one', () => {
    for (const step of STEPS) {
      for (const partCount of [0, 1, 5]) {
        for (const sheetCount of [0, 2]) {
          const s = wizardStepStatuses(step, { partCount, sheetCount });
          expect(s.filter((x) => x === 'current')).toHaveLength(1);
          expect(s[STEPS.indexOf(step)]).toBe('current');
        }
      }
    }
  });

  it('reads unknown ?adim= values as step 1', () => {
    expect(toStep('nope')).toBe('makine');
    expect(toStep(['export'])).toBe('export');
  });
});

describe('autosave indicator (T109)', () => {
  it('maps the save state to saved / saving / error / new', () => {
    expect(saveIndicator('idle', false)).toBe('new');
    expect(saveIndicator('idle', true)).toBe('saved');
    expect(saveIndicator('pending', true)).toBe('saving');
    expect(saveIndicator('saving', false)).toBe('saving');
    expect(saveIndicator('saved', true)).toBe('saved');
    expect(saveIndicator('error', true)).toBe('error');
    expect(saveIndicator('conflict', true)).toBe('error');
  });
});
