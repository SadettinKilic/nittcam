import { summarizeLayout, type Part, type Project, type VerificationState } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  THUMB_MAX_PARTS,
  WASTE_MAX_BARS,
  dashboardStats,
  isRecentWorthy,
  layoutThumb,
  machinesByUrgency,
  wasteSummary,
  type WasteInput,
} from './dashboard';
import { newProject } from './draft-project';
import { STATE_TONE, stepStatuses } from './machine-state';

const NOW = new Date('2026-11-18T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000).toISOString();

function rect(id: string, w: number, h: number, qty = 1): Part {
  return {
    id,
    name: id,
    qty,
    grain: { mode: 'free', angle: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    kind: 'rect',
    params: { w, h, r: 0 },
  };
}

describe('dashboardStats', () => {
  it('counts projects, drafts, verified and pending machines', () => {
    const s = dashboardStats({
      projects: [{ status: 'draft' }, { status: 'produced' }, { status: 'draft' }],
      machines: [{ state: 'verified' }, { state: 'draft' }, { state: 'reverify_needed' }],
      exports: [],
      now: NOW,
    });
    expect(s).toEqual({
      projects: 3,
      drafts: 2,
      exportsThisWeek: 0,
      machines: 3,
      verified: 1,
      pending: 2,
    });
  });

  it('counts exports of the last 7 days only (rolling window, future ignored)', () => {
    const s = dashboardStats({
      projects: [],
      machines: [],
      exports: [
        { createdAt: daysAgo(0.1) },
        { createdAt: daysAgo(6.9) },
        { createdAt: new Date(daysAgo(3)) },
        { createdAt: daysAgo(7) }, // exactly 7 days: outside
        { createdAt: daysAgo(30) },
        { createdAt: daysAgo(-1) }, // clock skew: in the future
      ],
      now: NOW,
    });
    expect(s.exportsThisWeek).toBe(3);
  });

  it('pending + verified always equals the machine count', () => {
    const states: VerificationState[] = [
      'draft',
      'air_cut_approved',
      'test_cut_approved',
      'verified',
      'reverify_needed',
    ];
    for (let n = 0; n < 32; n++) {
      const machines = states.filter((_, i) => (n >> i) & 1).map((state) => ({ state }));
      const s = dashboardStats({ projects: [], machines, exports: [], now: NOW });
      expect(s.verified + s.pending).toBe(machines.length);
    }
  });
});

describe('machinesByUrgency', () => {
  it('puts re-verify first, verified last, then sorts by name', () => {
    const order = machinesByUrgency([
      { name: 'Çelik', state: 'verified' as const },
      { name: 'Beta', state: 'draft' as const },
      { name: 'Alfa', state: 'draft' as const },
      { name: 'Zeta', state: 'reverify_needed' as const },
      { name: 'Delta', state: 'test_cut_approved' as const },
    ]).map((m) => m.name);
    expect(order).toEqual(['Zeta', 'Alfa', 'Beta', 'Delta', 'Çelik']);
  });

  it('does not mutate its input', () => {
    const input = [
      { name: 'B', state: 'verified' as const },
      { name: 'A', state: 'draft' as const },
    ];
    machinesByUrgency(input);
    expect(input.map((m) => m.name)).toEqual(['B', 'A']);
  });
});

describe('layoutThumb', () => {
  function withLayout(): Project {
    const p = newProject();
    p.parts = [rect('a', 600, 400, 2), rect('b', 300, 100)];
    p.layout = {
      sheets: [
        {
          placements: [
            { partId: 'a', index: 0, x: 10, y: 10, rot: 0, locked: false },
            { partId: 'a', index: 1, x: 700, y: 10, rot: 90, locked: false },
            { partId: 'b', index: 0, x: 10, y: 500, rot: 270, locked: true },
            { partId: 'gone', index: 0, x: 0, y: 0, rot: 0, locked: false },
          ],
        },
        { placements: [] },
      ],
    };
    return p;
  }

  it('is null without a layout', () => {
    expect(layoutThumb(newProject())).toBeNull();
  });

  it('draws the first sheet with rotated footprints and skips unknown parts', () => {
    const thumb = layoutThumb(withLayout());
    expect(thumb).toEqual({
      sheet: { width: 2800, height: 2070 },
      material: withLayout().stock.material,
      sheets: 2,
      parts: [
        { x: 10, y: 10, w: 600, h: 400, outline: null },
        { x: 700, y: 10, w: 400, h: 600, outline: null },
        { x: 10, y: 500, w: 100, h: 300, outline: null },
      ],
      utilisation: summarizeLayout(withLayout()).utilisationPercent,
    });
    expect(thumb?.utilisation).toBeGreaterThan(0);
    expect(thumb?.utilisation).toBeLessThanOrEqual(100);
  });

  it('caps the number of parts', () => {
    const p = newProject();
    p.parts = [rect('a', 10, 10, THUMB_MAX_PARTS + 50)];
    p.layout = {
      sheets: [
        {
          placements: Array.from({ length: THUMB_MAX_PARTS + 50 }, (_, i) => ({
            partId: 'a',
            index: i,
            x: (i % 100) * 12,
            y: Math.floor(i / 100) * 12,
            rot: 0 as const,
            locked: false,
          })),
        },
      ],
    };
    expect(layoutThumb(p)?.parts).toHaveLength(THUMB_MAX_PARTS);
  });
});

describe('machine state helpers', () => {
  it('has a badge tone for every state; only verified is green', () => {
    expect(Object.entries(STATE_TONE).filter(([, v]) => v === 'success')).toEqual([
      ['verified', 'success'],
    ]);
  });

  it('stepper: done up to the reached stage, the next one current', () => {
    expect(stepStatuses('draft')).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(stepStatuses('air_cut_approved')).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(stepStatuses('test_cut_approved')).toEqual(['done', 'done', 'done', 'current']);
    expect(stepStatuses('verified')).toEqual(['done', 'done', 'done', 'done']);
    // Re-verification restarts at the air cut (D-031).
    expect(stepStatuses('reverify_needed')).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });

  it('stepper: exactly one current stage unless verified', () => {
    for (const s of Object.keys(STATE_TONE) as VerificationState[]) {
      const current = stepStatuses(s).filter((x) => x === 'current').length;
      expect(current).toBe(s === 'verified' ? 0 : 1);
    }
  });
});

describe('wasteSummary (T180)', () => {
  const row = (
    id: string,
    days: number,
    sheetCount: number,
    wasteAreaM2: number,
    sheetAreaM2: number,
  ): WasteInput => ({
    id,
    name: id,
    updatedAt: new Date(daysAgo(days)),
    summary: {
      sheetCount,
      wasteAreaM2,
      sheetAreaM2,
      wastePercent: sheetAreaM2 > 0 ? (100 * wasteAreaM2) / sheetAreaM2 : 0,
    },
  });

  it('is null without a layout in the last 30 days', () => {
    expect(wasteSummary([], NOW)).toBeNull();
    expect(wasteSummary([row('old', 31, 1, 1, 5), row('empty', 1, 0, 0, 0)], NOW)).toBeNull();
  });

  it('sums the window, area-weighted, newest first', () => {
    const s = wasteSummary(
      [row('a', 10, 1, 1, 5.796), row('b', 2, 3, 6, 17.388), row('old', 40, 9, 9, 9)],
      NOW,
    );
    expect(s?.projects).toBe(2);
    expect(s?.sheets).toBe(4);
    expect(s?.wasteAreaM2).toBeCloseTo(7);
    expect(s?.sheetAreaM2).toBeCloseTo(23.184);
    expect(s?.wastePercent).toBeCloseTo((100 * 7) / 23.184);
    expect(s?.bars.map((b) => b.id)).toEqual(['b', 'a']);
  });

  it('caps the bars but keeps every project in the totals', () => {
    const rows = Array.from({ length: WASTE_MAX_BARS + 3 }, (_, i) => row(`p${i}`, i + 1, 1, 1, 4));
    const s = wasteSummary(rows, NOW);
    expect(s?.bars).toHaveLength(WASTE_MAX_BARS);
    expect(s?.projects).toBe(WASTE_MAX_BARS + 3);
    expect(s?.wastePercent).toBeCloseTo(25);
  });
});

describe('isRecentWorthy (P4)', () => {
  it('skips untouched empty drafts only', () => {
    expect(isRecentWorthy({ status: 'draft', data: { parts: [] } })).toBe(false);
    expect(isRecentWorthy({ status: 'draft', data: { parts: [1] } })).toBe(true);
    expect(isRecentWorthy({ status: 'produced', data: { parts: [] } })).toBe(true);
  });
});
