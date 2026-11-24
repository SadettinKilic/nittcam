import { describe, expect, it } from 'vitest';
import { tabsShortHeaders } from '../post/generate';
import { GOLDEN_OP_FIXTURES, goldenProfile, opFixtureProject } from '../post/golden.testing';
import { buildToolpath } from './build';
import type { Operation } from './types';

// T334 (field rehearsal N1): when a part gets fewer tabs than the setting, the operation carries
// `tabsWanted` (and `tabsRamp` when the ramp entry took the room), the NC header writes one
// "KÖPRÜ AZ" line, and nothing changes when every part has its tabs (goldens byte-identical).

const found = GOLDEN_OP_FIXTURES.find((f) => f.id === 'ramp-small');
if (!found) throw new Error('no ramp-small fixture');
const fx = found;
const profile = goldenProfile('generic');

function outerOps(withRamp: boolean): Operation[] {
  const straight = structuredClone(fx.cutting);
  delete straight.entry;
  const f = withRamp ? fx : { ...fx, cutting: straight };
  const tp = buildToolpath(opFixtureProject(f, 6), profile);
  if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
  return tp.toolpath.operations.filter((o) => o.kind === 'outerContour');
}

describe('toolpath tab shortfall fields (T334)', () => {
  it('ramp 3° with Ø6: the small blocks get 3 of 4 tabs, marked as the ramp; the panel keeps 4', () => {
    const ops = outerOps(true);
    const blocks = ops.filter((o) => o.partId === 'block');
    const panel = ops.filter((o) => o.partId === 'panel');
    expect(blocks).toHaveLength(4);
    for (const o of blocks) {
      expect(o.tabs).toHaveLength(3);
      expect(o.tabsWanted).toBe(4);
      expect(o.tabsRamp).toBe(true);
    }
    for (const o of panel) {
      expect(o.tabs).toHaveLength(4);
      expect(o.tabsWanted).toBeUndefined();
      expect(o.tabsRamp).toBeUndefined();
    }
  });

  it('straight plunge: every part has its tabs and no shortfall field is set', () => {
    for (const o of outerOps(false)) {
      expect(o.tabs).toHaveLength(4);
      expect('tabsWanted' in o).toBe(false);
      expect('tabsRamp' in o).toBe(false);
    }
  });
});

describe('tabsShortHeaders (T334)', () => {
  const op = (tabs: number, extra: Partial<Operation> = {}): Operation =>
    ({
      kind: 'outerContour',
      tabs: Array.from({ length: tabs }, () => ({})),
      ...extra,
    }) as unknown as Operation;

  it('no shortfall: no line', () => {
    expect(tabsShortHeaders([])).toEqual([]);
    expect(tabsShortHeaders([op(4), op(2)])).toEqual([]);
  });

  it('same count on every short part, ramp named', () => {
    expect(
      tabsShortHeaders([
        op(4),
        op(3, { tabsWanted: 4, tabsRamp: true }),
        op(3, { tabsWanted: 4, tabsRamp: true }),
      ]),
    ).toEqual(['KÖPRÜ AZ: 2 parçada 3 köprü, rampa nedeniyle']);
  });

  it('different counts: "en az" the minimum; cause not named when it is not the ramp', () => {
    expect(tabsShortHeaders([op(3, { tabsWanted: 4 }), op(2, { tabsWanted: 4 })])).toEqual([
      'KÖPRÜ AZ: 2 parçada en az 2 köprü',
    ]);
  });

  it('the ramp named when it took the room on any of the short parts', () => {
    expect(
      tabsShortHeaders([op(3, { tabsWanted: 4 }), op(3, { tabsWanted: 4, tabsRamp: true })]),
    ).toEqual(['KÖPRÜ AZ: 2 parçada 3 köprü, rampa nedeniyle']);
  });

  it('T338 (D-129): tabs that would not hold name the neighbour cut or the sheet edge', () => {
    expect(tabsShortHeaders([op(2, { tabsWanted: 4, tabsFacing: true })])).toEqual([
      'KÖPRÜ AZ: 1 parçada 2 köprü, komşu kesim ya da plaka kenarı nedeniyle',
    ]);
    expect(
      tabsShortHeaders([
        op(3, { tabsWanted: 4, tabsRamp: true }),
        op(2, { tabsWanted: 4, tabsFacing: true }),
      ]),
    ).toEqual([
      'KÖPRÜ AZ: 2 parçada en az 2 köprü, rampa, komşu kesim ya da plaka kenarı nedeniyle',
    ]);
  });

  it('only outer contours count; no parentheses (a Mach3 comment ends at the first one)', () => {
    const line = tabsShortHeaders([
      { ...op(1, { tabsWanted: 4 }), kind: 'innerContour' } as Operation,
      op(2, { tabsWanted: 3 }),
    ]);
    expect(line).toEqual(['KÖPRÜ AZ: 1 parçada 2 köprü']);
    expect(line.join('')).not.toMatch(/[()]/);
  });
});
