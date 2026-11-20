import { exportBlockingIssues, nestProject, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { blockingItems, blockingRule, issuePlace, withBlocking } from './blocking-issues';
import { newProject } from './draft-project';

// T287 (CTO #10 A, K2): one list for the Simülasyon badge and the Dışa aktar lock.

const rect = (id: string, name: string, w: number, h: number) => ({
  id,
  name,
  qty: 1,
  grain: { mode: 'free' as const, angle: 0 },
  kind: 'rect' as const,
  params: { w, h, r: 0 },
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  templates: [],
});

function nested(): Project {
  const p = newProject();
  p.parts = [rect('raf', 'Raf', 564, 520)] as unknown as Project['parts'];
  return { ...p, layout: nestProject(p, { toolDiameter: 8 }).layout };
}

describe('issuePlace', () => {
  const parts = [{ id: 'a' }, { id: 'b' }];
  it('reads sheet, part row and drawn items from the validation path', () => {
    expect(issuePlace(parts, 'layout.sheets[2].placements[0]')).toEqual({ sheet: 2 });
    expect(issuePlace(parts, 'parts[1]')).toEqual({ partId: 'b' });
    expect(issuePlace(parts, 'parts[1].params')).toEqual({ partId: 'b' });
    expect(issuePlace(parts, 'parts[0].inners[3].contour')).toEqual({ partId: 'a', inner: 3 });
    expect(issuePlace(parts, 'parts[0].holes[1].depth')).toEqual({ partId: 'a', hole: 1 });
    expect(issuePlace(parts, 'parts[0].lines[0]')).toEqual({ partId: 'a', openLine: 0 });
    expect(issuePlace(parts, 'parts[9]')).toEqual({});
    expect(issuePlace(parts, 'stock.sheet')).toEqual({});
  });

  it('layout codes are grouped under Dizilim', () => {
    expect(blockingRule('PART_NOT_IN_LAYOUT')).toBe('LAYOUT');
    expect(blockingRule('PLACEMENT_GRAIN')).toBe('LAYOUT');
    expect(blockingRule('PART_LARGER_THAN_SHEET')).toBe('TOOLPATH');
  });
});

describe('blockingItems', () => {
  it('a nested project has none; a part added after nesting is named', () => {
    const p = nested();
    expect(blockingItems(p.parts, exportBlockingIssues(p))).toEqual([]);
    const late = { ...p, parts: [...p.parts, rect('tezgah', 'Tezgah', 300, 200)] } as Project;
    expect(blockingItems(late.parts, exportBlockingIssues(late))).toEqual([
      expect.objectContaining({ code: 'PART_NOT_IN_LAYOUT', rule: 'LAYOUT', partId: 'tezgah' }),
    ]);
  });

  it('an oversize part is named by its row', () => {
    const p = nested();
    const big = { ...p, parts: [...p.parts, rect('tezgah', 'Tezgah', 3000, 600)] } as Project;
    expect(blockingItems(big.parts, exportBlockingIssues(big))).toEqual([
      expect.objectContaining({ code: 'PART_LARGER_THAN_SHEET', partId: 'tezgah' }),
    ]);
  });
});

describe('withBlocking (Simülasyon list = run findings + export lock)', () => {
  type F = { code: string; severity: string; partId?: string; hole?: number; sheet?: number };
  const f = (x: F): F => x;

  it('adds a part that is not in the layout and drops the generic copies warning', () => {
    const own = [f({ code: 'UNPLACED_COPIES', severity: 'warning' })];
    const blocking = [f({ code: 'PART_NOT_IN_LAYOUT', severity: 'error', partId: 'tezgah' })];
    expect(withBlocking(own, blocking).map((x) => x.code)).toEqual(['PART_NOT_IN_LAYOUT']);
  });

  it('a drawn item the toolpath refused is not repeated under the validation code', () => {
    const own = [f({ code: 'HOLE_DEPTH_INVALID', severity: 'error', partId: 'kapak', hole: 2 })];
    const blocking = [
      f({ code: 'HOLE_DEPTH_NOT_BELOW_THICKNESS', severity: 'error', partId: 'kapak', hole: 2 }),
      f({ code: 'HOLE_SMALLER_THAN_TOOL', severity: 'error', partId: 'kapak', hole: 0 }),
    ];
    expect(withBlocking(own, blocking).map((x) => `${x.code}#${x.hole}`)).toEqual([
      'HOLE_DEPTH_INVALID#2',
      'HOLE_SMALLER_THAN_TOOL#0',
    ]);
  });

  it('keeps the copies warning without a part-level error; same code + place once', () => {
    const own = [
      f({ code: 'UNPLACED_COPIES', severity: 'warning' }),
      f({ code: 'PLACEMENT_GRAIN', severity: 'error', sheet: 0 }),
    ];
    expect(
      withBlocking(own, [f({ code: 'PLACEMENT_GRAIN', severity: 'error', sheet: 0 })]),
    ).toEqual(own);
  });
});
