import { describe, expect, it } from 'vitest';
import { findMaterialParams } from '../machine';
import { ACM_V_GROOVE_ROW, startingValueRow, suggestCuttingSet } from '../machine/starting-values';
import { vGrooveProfile, vGrooveTrayProject } from '../post/golden.testing';
import { buildToolpath } from './build';
import { recommendationSource, recommendedFeeds, recommendedRpm } from './op-tools';
import { spindleSettingsOf } from './spindle';

const VBIT = { type: 'vBit', diameter: 12, flutes: 2, fluteLength: 8 } as const;

describe('V-bit feed from its own research row (T424)', () => {
  it('the table holds the ACM V-groove row for any V-bit diameter', () => {
    expect(startingValueRow('acm', VBIT)).toBe(ACM_V_GROOVE_ROW);
    expect(startingValueRow('acm', { ...VBIT, diameter: 25 })).toBe(ACM_V_GROOVE_ROW);
    expect(startingValueRow('mdf', VBIT)).toBeUndefined();
    expect(ACM_V_GROOVE_ROW.sources).toEqual(['S8', 'S18', 'S20', 'S21']);
  });

  it('suggestion: 1500 / 300 mm/min at 18 000 rpm, chip load ≤ 0,05 mm per tooth', () => {
    const s = suggestCuttingSet('acm', 4, VBIT, { minRpm: 6000, maxRpm: 24000 });
    expect(s).toMatchObject({ feed: 1500, plungeFeed: 300, rpm: 18000 });
    expect(s?.chipLoad).toBeLessThanOrEqual(0.05);
    // a slow spindle clamps the rpm and the feed follows (chip load kept)
    const slow = suggestCuttingSet('acm', 4, VBIT, { minRpm: 6000, maxRpm: 12000 });
    expect(slow?.rpm).toBe(12000);
    expect(slow?.chipLoad).toBeLessThanOrEqual(0.05);
  });

  it('the tray job: the V-bit takes the row, never the contour set (F6000 before)', () => {
    const profile = vGrooveProfile('mach3');
    const project = vGrooveTrayProject(8);
    const set = findMaterialParams(profile, project.stock);
    if (!set) throw new Error('no set');
    expect(recommendedFeeds(project, profile, set, 7)).toEqual({ feed: 1500, plungeFeed: 300 });
    expect(recommendedRpm(project, profile, set, 7)).toBe(18000);
    expect(recommendationSource(project, profile, set, 7)).toBe('startingValue');
    // the contour tool keeps its set
    expect(recommendedFeeds(project, profile, set, set.tool)).toEqual({
      feed: set.feed,
      plungeFeed: set.plungeFeed,
    });
    expect(recommendationSource(project, profile, set, set.tool)).toBe('set');
    const tp = buildToolpath(project, profile);
    expect(tp.ok).toBe(true);
    if (!tp.ok) return;
    const grooves = tp.toolpath.operations.filter((o) => o.kind === 'vgroove');
    expect(grooves.length).toBe(4);
    for (const g of grooves) expect([g.feed, g.plungeFeed, g.rpm]).toEqual([1500, 300, 18000]);
    const row = spindleSettingsOf(project, profile).find((r) => r.tool === 7);
    expect(row?.recommendedSource).toBe('startingValue');
    expect(row?.chipLoad).toBeLessThanOrEqual(0.05);
  });

  it('a verified set naming the V-bit wins over the row; the project value over both', () => {
    const profile = vGrooveProfile('mach3');
    const project = vGrooveTrayProject(8);
    const set = findMaterialParams(profile, project.stock);
    if (!set) throw new Error('no set');
    profile.materials.push({ ...set, tool: 7, feed: 1200, plungeFeed: 300, rpm: 20000 });
    expect(recommendedFeeds(project, profile, set, 7)).toEqual({ feed: 1200, plungeFeed: 300 });
    expect(recommendedRpm(project, profile, set, 7)).toBe(20000);
    expect(recommendationSource(project, profile, set, 7)).toBe('toolSet');
    const own = {
      ...project,
      cutting: { ...project.cutting, feeds: { 7: { feed: 1000, plungeFeed: 250 } } },
    };
    const tp = buildToolpath(own as typeof project, profile);
    if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
    const g = tp.toolpath.operations.find((o) => o.kind === 'vgroove');
    expect(g?.feed).toBe(1000);
  });
});
