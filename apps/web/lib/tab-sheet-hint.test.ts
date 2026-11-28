import { applyCommand, summarizeLayout, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { newProject } from './draft-project';
import { hintSkinThickness, tabSheetProbe, tabSheetSaving } from './tab-sheet-hint';

/**
 * Seven 390 × 2050 strips on a 2800 × 2070 MDF sheet: with thin skin (pay 0,1 → 6,1 mm between
 * cuts) all seven fit side by side; with tabs (D-129: Ø6 + 3 + 0,1 = 9,1 pay → 15,1 mm) only six,
 * and the seventh needs a second sheet used ~14 %.
 */
function strips(): Project {
  const r = applyCommand(newProject(), 'addPart', {
    id: 's',
    name: 'Strip',
    params: { w: 390, h: 2050, r: 0 },
    qty: 7,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.project;
}

function nested(p: Project): Project {
  const r = applyCommand(p, 'runNesting', { toolDiameter: 6 });
  if (!r.ok) throw new Error(r.error.message);
  return r.project;
}

describe('T428: hint when tabs cause an extra sheet', () => {
  it('tabs need a second, nearly empty sheet; the thin-skin probe fits one, the hint offers it', () => {
    const tabs = nested(strips());
    const summary = summarizeLayout(tabs);
    expect(summary.sheetCount).toBe(2);
    const probe = tabSheetProbe(tabs, 6, summary);
    expect(probe?.cutting.skin).toEqual({ thickness: hintSkinThickness(18) });
    if (!probe) return;
    const withSkin = summarizeLayout(nested(probe));
    expect(withSkin.sheetCount).toBe(1);
    expect(tabSheetSaving(summary, withSkin)).toBe(1);
  });

  it('no probe with thin skin on, without a tool, on one sheet or when the last sheet is well used', () => {
    const tabs = nested(strips());
    const summary = summarizeLayout(tabs);
    const skin = { ...tabs, cutting: { ...tabs.cutting, skin: { thickness: 0.5 } } };
    expect(tabSheetProbe(skin, 6, summary)).toBeNull();
    expect(tabSheetProbe(tabs, 0, summary)).toBeNull();
    expect(tabSheetProbe(tabs, 6, undefined)).toBeNull();
    expect(tabSheetProbe(tabs, 6, { ...summary, sheetCount: 1 })).toBeNull();
    const busy = summary.sheets.map((s) => ({ ...s, partArea: s.sheetArea * 0.5 }));
    expect(tabSheetProbe(tabs, 6, { ...summary, sheets: busy })).toBeNull();
  });

  it('ACM offers no thin skin: no hint', () => {
    const tabs = nested(strips());
    const acm = { ...tabs, stock: { ...tabs.stock, material: 'acm', thickness: 4 } } as Project;
    expect(tabSheetProbe(acm, 6, summarizeLayout(tabs))).toBeNull();
  });

  it('saving only when the probe needs fewer sheets and places every copy', () => {
    expect(tabSheetSaving({ sheetCount: 3 }, { sheetCount: 2, unplaced: [] })).toBe(2);
    expect(tabSheetSaving({ sheetCount: 3 }, { sheetCount: 3, unplaced: [] })).toBeNull();
    expect(
      tabSheetSaving({ sheetCount: 3 }, { sheetCount: 2, unplaced: [{ partId: 'a', index: 0 }] }),
    ).toBeNull();
    expect(tabSheetSaving({ sheetCount: 3 }, undefined)).toBeNull();
  });
});
