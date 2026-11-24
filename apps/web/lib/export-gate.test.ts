import { describe, expect, it } from 'vitest';
import { downloadBlocker, EMPTY_CHECKLIST, errorCount } from './export-gate';

const FILE = { name: 'a.nc', size: 10, hash: 'h', sheet: 0 };
const ALL = { origin: true, tool: true, airCut: true, toolChange: false, templates: false };

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

  it('unverified ready templates add a line that must be ticked (T282)', () => {
    const p = { ok: true, files: [FILE], needsAcceptance: true };
    expect(downloadBlocker(p, { ...ALL, templates: false }, true, 1)).toBe('checklist');
    expect(downloadBlocker(p, { ...ALL, templates: true }, false, 1)).toBe('accept');
    expect(downloadBlocker(p, { ...ALL, templates: true }, true, 2)).toBeNull();
    expect(downloadBlocker(p, { ...ALL, templates: false }, true, 0)).toBeNull();
  });

  it('a feed far above the recommendation adds a line that must be ticked (T330)', () => {
    const high = {
      tool: 2,
      feed: 9100,
      plungeFeed: 1500,
      recommendedFeed: 6000,
      recommendedPlungeFeed: 1500,
    };
    const checklist = {
      origin: {
        corner: 'frontLeft' as const,
        xPositive: 'right' as const,
        yPositive: 'back' as const,
        sheetOffset: { x: 0, y: 0 },
      },
      zReference: 'materialTop' as const,
      tools: [],
      toolChanges: 0,
      rezeroZ: false,
      parkOff: false,
      highFeeds: [high],
    };
    const p = { ok: true, files: [FILE], needsAcceptance: false, checklist };
    expect(downloadBlocker(p, ALL, false)).toBe('checklist');
    expect(downloadBlocker(p, { ...ALL, feeds: true }, false)).toBeNull();
    expect(
      downloadBlocker({ ...p, checklist: { ...checklist, highFeeds: [] } }, ALL, false),
    ).toBeNull();
  });

  it('a vacuum the program does not switch adds a line that must be ticked (T336)', () => {
    const base = {
      origin: {
        corner: 'frontLeft' as const,
        xPositive: 'right' as const,
        yPositive: 'back' as const,
        sheetOffset: { x: 0, y: 0 },
      },
      zReference: 'materialTop' as const,
      tools: [],
      toolChanges: 0,
      rezeroZ: false,
      parkOff: false,
    };
    const p = (checklist: typeof base & { vacuumByHand?: true }) => ({
      ok: true,
      files: [FILE],
      needsAcceptance: false,
      checklist,
    });
    expect(downloadBlocker(p({ ...base, vacuumByHand: true }), ALL, false)).toBe('checklist');
    expect(
      downloadBlocker(p({ ...base, vacuumByHand: true }), { ...ALL, vacuum: true }, false),
    ).toBeNull();
    // a program that switches the vacuum: no line, nothing to tick
    expect(downloadBlocker(p(base), ALL, false)).toBeNull();
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
      parkOff: false,
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
