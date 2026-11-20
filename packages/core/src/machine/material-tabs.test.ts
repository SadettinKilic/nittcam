import { describe, expect, it } from 'vitest';
import { inheritedTabs } from '../toolpath/cutting-settings';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { defaultMachineProfile } from './defaults';
import {
  materialTabIssues,
  parseMachineProfile,
  parseMachineProfileForSave,
  type MachineProfile,
} from './profile';

// T302 (CTO #12 E3): tab defaults of a material set, saved with the T293 holding bounds.

function withTabs(tabs: unknown, thickness = 18): unknown {
  const p = JSON.parse(JSON.stringify(defaultMachineProfile())) as {
    materials: Record<string, unknown>[];
  };
  const set = p.materials[0] as Record<string, unknown>;
  set.thickness = thickness;
  set.stepDown = Math.min(6, thickness);
  set.tabs = tabs;
  return p;
}

describe('material set tab defaults (T302)', () => {
  it('a set without tabs stays valid (older profiles)', () => {
    const p = defaultMachineProfile();
    expect(p.materials.every((m) => m.tabs === undefined)).toBe(true);
    expect(parseMachineProfileForSave(p).ok).toBe(true);
  });

  it('accepts sizes inside the bounds (6 × 12 × 2 on 18 mm)', () => {
    const r = parseMachineProfileForSave(withTabs({ count: 6, width: 12, height: 2 }));
    expect(r.ok).toBe(true);
  });

  it('refuses a bridge below 3 mm wide or 1 mm high, saying the bound', () => {
    const r = parseMachineProfileForSave(withTabs({ count: 4, width: 2, height: 0.5 }));
    expect(r.ok).toBe(false);
    const issues = r.ok ? [] : r.issues;
    expect(issues).toContainEqual(
      expect.objectContaining({ path: 'materials[0].tabs.width', code: 'too_small', minimum: 3 }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: 'materials[0].tabs.height', code: 'too_small', minimum: 1 }),
    );
  });

  it('refuses a height above thickness − 1 mm with the maximum', () => {
    const issues = materialTabIssues(
      withTabs({ count: 4, width: 10, height: 17.5 }) as MachineProfile,
    );
    expect(issues).toEqual([
      expect.objectContaining({ path: 'materials[0].tabs.height', code: 'too_big', maximum: 17 }),
    ]);
    expect(
      materialTabIssues(withTabs({ count: 4, width: 10, height: 17 }) as MachineProfile),
    ).toEqual([]);
  });

  it('reading stays lenient: a stored set below the bounds still parses', () => {
    expect(parseMachineProfile(withTabs({ count: 4, width: 1, height: 0.5 })).ok).toBe(true);
  });

  it('inheritedTabs: material set values, else the built-in default, ignoring project values', () => {
    const project = projectOf({ parts: [{ id: 'a', w: 300, h: 200, qty: 1 }] });
    const plain = machineOf({ thickness: 18 });
    expect(inheritedTabs(project, plain)).toEqual({
      count: 4,
      width: 10,
      height: 3,
      source: 'default',
    });
    const m = JSON.parse(JSON.stringify(plain)) as MachineProfile;
    for (const s of m.materials) s.tabs = { count: 6, width: 12, height: 2 };
    expect(inheritedTabs(project, m)).toEqual({
      count: 6,
      width: 12,
      height: 2,
      source: 'material',
    });
    const own = {
      ...project,
      cutting: { ...project.cutting, tabs: { ...project.cutting.tabs, count: 9, width: 20 } },
    };
    expect(inheritedTabs(own, m)).toEqual({ count: 6, width: 12, height: 2, source: 'material' });
  });
});
