import { defaultMachineProfile, validateProject, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { fill, newProject } from './draft-project';
import { holeErrors, itemPlace, machineRelated, onDrawnItem } from './part-items';

// T275: hole errors are named where the hole is drawn (B13a / T270 pattern).

function door(holes: unknown[]): Project {
  const p = newProject();
  p.parts = [
    {
      id: 'kapak',
      name: 'Kapak',
      qty: 1,
      grain: { mode: 'free', angle: 0 },
      kind: 'rect',
      params: { w: 596, h: 716, r: 0 },
      inners: [],
      holes,
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    } as unknown as Project['parts'][number],
  ];
  return p;
}

describe('holeErrors (T275)', () => {
  it('collects the four hole errors of the review by hole index, warnings left out', () => {
    const machine = defaultMachineProfile(); // T1 Ø6, T2 Ø8
    const project = door([
      { id: 'ok', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 },
      { id: 'small', type: 'through', d: 5, cx: 120, cy: 60, tool: 2 },
      { id: 't9', type: 'through', d: 10, cx: 180, cy: 60, tool: 9 },
      { id: 'deep', type: 'pocket', d: 35, cx: 250, cy: 150, depth: 30, tool: 2 },
      { id: 'near', type: 'pocket', d: 35, cx: 350, cy: 150, depth: 17.5, tool: 2 },
    ]);
    const issues = validateProject(project, { machine });
    const byHole = holeErrors(project, issues).get('kapak');
    expect(byHole && [...byHole.keys()].sort()).toEqual([1, 2, 3]);
    expect(byHole?.get(1)?.map((i) => i.code)).toEqual(['HOLE_SMALLER_THAN_TOOL']);
    expect(byHole?.get(2)?.map((i) => i.code)).toEqual(['TOOL_NOT_IN_PROFILE']);
    expect(byHole?.get(3)?.map((i) => i.code)).toEqual(['HOLE_DEPTH_NOT_BELOW_THICKNESS']);
  });
});

describe('itemPlace / machineRelated (T270, T275)', () => {
  const parts = [{ id: 'kapak', name: 'Kapak' }];
  const text = { innerPlace: '{name} · İç kesim {n}', holePlace: '{name} · Delik {n}' };

  it('names the hole and the cut-out by part and 1-based number', () => {
    expect(itemPlace({ code: 'X', partId: 'kapak', hole: 2 }, parts, text, fill)).toBe(
      'Kapak · Delik 3',
    );
    expect(itemPlace({ code: 'X', partId: 'kapak', inner: 0 }, parts, text, fill)).toBe(
      'Kapak · İç kesim 1',
    );
    expect(itemPlace({ code: 'X', partId: 'kapak' }, parts, text, fill)).toBeNull();
    expect(itemPlace({ code: 'X', partId: 'gone', hole: 0 }, parts, text, fill)).toBeNull();
    expect(onDrawnItem({ code: 'X', partId: 'kapak', hole: 0 })).toBe(true);
    expect(onDrawnItem({ code: 'X', partId: 'kapak' })).toBe(false);
  });

  it('the machine link only when the fix may be on the machine', () => {
    expect(machineRelated({ code: 'NO_CUTTING_PARAMS' })).toBe(true);
    expect(machineRelated({ code: 'INNER_SLUG_UNSECURED', inner: 0 })).toBe(false);
    expect(machineRelated({ code: 'TOOL_NOT_IN_PROFILE', hole: 0 })).toBe(true);
    expect(machineRelated({ code: 'HOLE_SMALLER_THAN_TOOL', hole: 0 })).toBe(true);
    expect(machineRelated({ code: 'HOLE_DEPTH_INVALID', hole: 0 })).toBe(false);
    expect(machineRelated({ code: 'HOLE_OUTSIDE_PART', hole: 0 })).toBe(false);
  });
});
