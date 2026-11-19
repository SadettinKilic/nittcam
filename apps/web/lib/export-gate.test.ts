import { describe, expect, it } from 'vitest';
import { downloadBlocker, EMPTY_CHECKLIST, errorCount } from './export-gate';

const FILE = { name: 'a.nc', size: 10, hash: 'h', sheet: 0 };
const ALL = { origin: true, tool: true, airCut: true, toolChange: false };

describe('downloadBlocker (§6.6 checklist, §7.2 rules 9–10)', () => {
  it('no preview or failed checks block first', () => {
    expect(downloadBlocker(null, ALL, true)).toBe('checks');
    expect(downloadBlocker({ ok: false, files: [], needsAcceptance: false }, ALL, true)).toBe(
      'checks',
    );
    expect(downloadBlocker({ ok: true, files: [], needsAcceptance: false }, ALL, true)).toBe(
      'checks',
    );
  });

  it('every checklist item must be ticked', () => {
    const p = { ok: true, files: [FILE], needsAcceptance: false };
    expect(downloadBlocker(p, EMPTY_CHECKLIST, false)).toBe('checklist');
    expect(downloadBlocker(p, { ...ALL, airCut: false }, false)).toBe('checklist');
    expect(downloadBlocker(p, { ...ALL, origin: false }, false)).toBe('checklist');
    expect(downloadBlocker(p, { ...ALL, tool: false }, false)).toBe('checklist');
    expect(downloadBlocker(p, ALL, false)).toBeNull();
  });

  it('manual tool changes need their own confirmation (T274)', () => {
    const checklist = {
      origin: {
        corner: 'frontLeft' as const,
        xPositive: 'right' as const,
        yPositive: 'back' as const,
        sheetOffset: { x: 0, y: 0 },
      },
      zReference: 'materialTop' as const,
      tools: [],
      rezeroZ: true,
    };
    const two = {
      ok: true,
      files: [FILE],
      needsAcceptance: false,
      checklist: { ...checklist, toolChanges: 2 },
    };
    expect(downloadBlocker(two, ALL, false)).toBe('checklist');
    expect(downloadBlocker(two, { ...ALL, toolChange: true }, false)).toBeNull();
    const none = { ...two, checklist: { ...checklist, toolChanges: 0 } };
    expect(downloadBlocker(none, ALL, false)).toBeNull();
  });

  it('an unverified profile needs the acceptance', () => {
    const p = { ok: true, files: [FILE], needsAcceptance: true };
    expect(downloadBlocker(p, ALL, false)).toBe('accept');
    expect(downloadBlocker(p, ALL, true)).toBeNull();
  });

  it('errorCount counts errors only and is at least 1', () => {
    expect(errorCount({ violations: [] })).toBe(1);
    const v = { stage: 'check' as const, rule: 'R1', code: 'X', message: 'm' };
    expect(
      errorCount({
        violations: [
          { ...v, severity: 'error' },
          { ...v, severity: 'warning' },
          { ...v, severity: 'error' },
        ],
      }),
    ).toBe(2);
  });
});
