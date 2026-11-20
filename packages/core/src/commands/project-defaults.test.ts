import { describe, expect, it } from 'vitest';
import { parseProject } from '../schema';
import { cuttingSettingsOf } from '../toolpath';
import fixture from '../schema/__fixtures__/shelf-set.json';
import {
  BUILT_IN_PROJECT_DEFAULTS,
  applyProjectDefaults,
  resolveProjectDefaults,
} from './project-defaults';

function project() {
  const r = parseProject(fixture);
  if (!r.ok) throw new Error('fixture');
  return r.project;
}

describe('project defaults (T182)', () => {
  it('resolve keeps valid fields and falls back per field', () => {
    expect(resolveProjectDefaults(null)).toEqual(BUILT_IN_PROJECT_DEFAULTS);
    expect(resolveProjectDefaults({ gap: 12, margin: -1, tabMode: 'off', leadIn: 'zig' })).toEqual({
      ...BUILT_IN_PROJECT_DEFAULTS,
      gap: 12,
      tabMode: 'off',
    });
  });

  it('apply sets the same fields the T288 settings read (one source)', () => {
    const p = applyProjectDefaults(project(), {
      gap: 5,
      margin: 15,
      tabMode: 'off',
      leadIn: 'line',
      direction: 'conventional',
      dimensionMode: 'finished',
    });
    expect(p.nesting).toMatchObject({ gap: 5, margin: 15 });
    expect(p.settings.dimensionMode).toBe('finished');
    const c = cuttingSettingsOf(p);
    expect(c.tabMode).toBe('off');
    expect(c.skin).toBeGreaterThan(0);
    expect(c.leadIn).toBe('line');
    expect(c.direction).toBe('conventional');
    // tab sizes are not touched: they still come from the material set / built-in default
    expect(Object.values(c.tabs.source)).not.toContain('project');
    expect(parseProject(p).ok).toBe(true);
  });

  it('small and all map to the tab flags like setTabs', () => {
    const small = applyProjectDefaults(project(), {
      ...BUILT_IN_PROJECT_DEFAULTS,
      tabMode: 'small',
    });
    expect(cuttingSettingsOf(small).tabMode).toBe('small');
    const all = applyProjectDefaults(project(), BUILT_IN_PROJECT_DEFAULTS);
    expect(cuttingSettingsOf(all).tabMode).toBe('all');
  });
});
