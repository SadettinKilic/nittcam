import { describe, expect, it } from 'vitest';
import { partsViewKey, resumeStep } from './wizard-steps';

describe('resumeStep (T290)', () => {
  it('opens where work stopped', () => {
    expect(resumeStep({ partCount: 0, sheetCount: 0, exported: false })).toBe('parcalar');
    expect(resumeStep({ partCount: 3, sheetCount: 0, exported: false })).toBe('parcalar');
    expect(resumeStep({ partCount: 3, sheetCount: 2, exported: false })).toBe('dizilim');
    expect(resumeStep({ partCount: 3, sheetCount: 2, exported: true })).toBe('export');
    // An export of an older revision whose layout was cleared since: back to Parçalar.
    expect(resumeStep({ partCount: 3, sheetCount: 0, exported: true })).toBe('parcalar');
  });

  it('keys the remembered view per project', () => {
    expect(partsViewKey('abc')).toBe('nittcam.partsView.abc');
  });
});
