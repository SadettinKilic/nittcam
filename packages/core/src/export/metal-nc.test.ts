import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import type { Project } from '../schema';
import { exportBlockingIssues, validateProject } from '../validate';
import { exportNc } from './export';

// T346 (D-130): ACM NC carries "DOGRULANMAMIS MALZEME: ACM"; aluminium NC is blocked by
// validation (MATERIAL_NOT_RELEASED); today's materials get neither.

function withMaterial(material: string, thickness: number): [Project, MachineProfile] {
  const p = goldenProject(shelfSet, 8);
  p.stock = { ...p.stock, material, thickness };
  const profile = goldenProfile('mach3');
  const base = profile.materials[0];
  if (!base) throw new Error('no material set');
  profile.materials = [
    ...profile.materials,
    {
      ...base,
      material: material as MachineProfile['materials'][number]['material'],
      thickness,
      stepDown: Math.min(base.stepDown, thickness),
      tabs: undefined,
    },
  ];
  return [p, profile];
}

const header = (r: ReturnType<typeof exportNc>) =>
  r.files.map((f) => f.content.split('\n').slice(0, 12).join('\n')).join('\n');

describe('metal NC gating (T346, D-130)', () => {
  it('ACM: every file names the unverified material in its header', () => {
    const [p, profile] = withMaterial('acm', 4);
    const r = exportNc(p, { profile, version: 1, verification: 'draft' }, postConfig('mach3'));
    expect(r.postErrors).toEqual([]);
    expect(r.files.length).toBeGreaterThan(0);
    for (const f of r.files) expect(f.content).toContain('DOGRULANMAMIS MALZEME: ACM');
    expect(validateProject(p, { machine: profile }).map((i) => i.code)).not.toContain(
      'MATERIAL_NOT_RELEASED',
    );
  });

  it('MDF: no material line (goldens stay byte-identical)', () => {
    const p = goldenProject(shelfSet, 8);
    const profile = goldenProfile('mach3');
    const r = exportNc(p, { profile, version: 1, verification: 'draft' }, postConfig('mach3'));
    expect(r.files.length).toBeGreaterThan(0);
    expect(header(r)).not.toContain('DOGRULANMAMIS MALZEME');
  });

  it('aluminium: MATERIAL_NOT_RELEASED blocks the export; MDF and ACM are not blocked by it', () => {
    const [alu, profile] = withMaterial('alüminyum', 3);
    const codes = exportBlockingIssues(alu, { machine: profile }).map((i) => i.code);
    expect(codes).toContain('MATERIAL_NOT_RELEASED');
    for (const [m, t] of [
      ['mdf', 18],
      ['acm', 4],
    ] as const) {
      const [p, prof] = withMaterial(m, t);
      expect(exportBlockingIssues(p, { machine: prof }).map((i) => i.code)).not.toContain(
        'MATERIAL_NOT_RELEASED',
      );
    }
  });
});
