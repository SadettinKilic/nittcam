import { defaultMachineProfile, parsePostConfig } from '@nittcam/core';
import { POST_CONFIGS } from '@nittcam/machines';
import { describe, expect, it } from 'vitest';
import { CONTROLLER_LIBRARY, controllerProfile } from './controller-library';

describe('controller library (T181)', () => {
  it('lists generic and Mach3, each pre-filled from its post config', () => {
    expect(CONTROLLER_LIBRARY.map((c) => c.id)).toEqual(['generic', 'mach3']);
    for (const c of CONTROLLER_LIBRARY) {
      const p = controllerProfile(c.id);
      const cfg = parsePostConfig(POST_CONFIGS[c.id]);
      if (!p || !cfg.ok) throw new Error(c.id);
      expect(p.post).toEqual({ id: cfg.config.id, version: cfg.config.version });
      expect(p.toolChanger.type).toBe(cfg.config.toolChange.mode);
      expect(p.constraints.maxFileNameLength).toBe(cfg.config.file.maxNameLength);
    }
  });

  it('keeps the typed name, brand, model and notes; unknown id is null', () => {
    const typed = defaultMachineProfile();
    typed.identity = { ...typed.identity, name: 'Atölye 1', brand: 'X', model: 'Y', notes: 'n' };
    const p = controllerProfile('mach3', typed);
    expect(p?.identity).toMatchObject({ name: 'Atölye 1', brand: 'X', model: 'Y', notes: 'n' });
    expect(p?.identity.controller.family).toBe('Mach3');
    expect(controllerProfile('nope')).toBeNull();
  });
});
