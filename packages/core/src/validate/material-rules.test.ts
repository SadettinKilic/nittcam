import { describe, expect, it } from 'vitest';
import type { MachineProfile } from '../machine';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { cutPart, effectiveDimensionMode, type Project } from '../schema';
import { projectReport } from '../report/report';
import { projectNotices, validateProject } from '.';

// T349: material rules in validation (tool type per material, metal machine, ignored edge band).

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

/** The set of the stock cuts with a compression tool (new tool 9, like the set's own tool). */
function compressionSet(profile: MachineProfile, material: string): void {
  const set = profile.materials.find((m) => m.material === material);
  const tool = profile.tools.find((t) => t.number === set?.tool);
  if (!set || !tool) throw new Error('no set');
  profile.tools = [...profile.tools, { ...tool, number: 9, type: 'compression' }];
  set.tool = 9;
}

const codes = (p: Project, machine: MachineProfile) =>
  validateProject(p, { machine }).map((i) => i.code);

describe('TOOL_TYPE_UNSUITABLE_FOR_MATERIAL (T349)', () => {
  it('a compression set tool on ACM is an error; on MDF it is fine', () => {
    const [acm, profile] = withMaterial('acm', 4);
    compressionSet(profile, 'acm');
    const issues = validateProject(acm, { machine: profile }).filter(
      (i) => i.code === 'TOOL_TYPE_UNSUITABLE_FOR_MATERIAL',
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error' && i.path === 'stock.material')).toBe(true);
    const [mdf, mdfProfile] = withMaterial('mdf', 18);
    compressionSet(mdfProfile, 'mdf');
    expect(codes(mdf, mdfProfile)).not.toContain('TOOL_TYPE_UNSUITABLE_FOR_MATERIAL');
  });

  it('a flat end mill on ACM and aluminium passes; no profile skips the rule', () => {
    for (const [m, t] of [
      ['acm', 4],
      ['aluminium', 3],
    ] as const) {
      const [p, profile] = withMaterial(m, t);
      expect(codes(p, profile)).not.toContain('TOOL_TYPE_UNSUITABLE_FOR_MATERIAL');
      expect(validateProject(p).map((i) => i.code)).not.toContain(
        'TOOL_TYPE_UNSUITABLE_FOR_MATERIAL',
      );
    }
  });

  it('a chosen tool is left to OPERATION_TOOL_UNSUITABLE (one message per problem)', () => {
    const [acm, profile] = withMaterial('acm', 4);
    compressionSet(profile, 'acm');
    acm.cutting = { ...acm.cutting, tools: { outer: 9, inner: 9 } };
    const c = codes(acm, profile);
    expect(c).toContain('OPERATION_TOOL_UNSUITABLE');
    expect(c).not.toContain('TOOL_TYPE_UNSUITABLE_FOR_MATERIAL');
  });
});

describe('MATERIAL_NOT_ALLOWED_ON_MACHINE (T349)', () => {
  it('aluminium needs metal.enabled; ACM and MDF do not', () => {
    const [alu, profile] = withMaterial('aluminium', 3);
    expect(codes(alu, profile)).toContain('MATERIAL_NOT_ALLOWED_ON_MACHINE');
    profile.metal = { enabled: false, rigidity: 'standard' };
    expect(codes(alu, profile)).toContain('MATERIAL_NOT_ALLOWED_ON_MACHINE');
    profile.metal = { enabled: true, rigidity: 'standard' };
    expect(codes(alu, profile)).not.toContain('MATERIAL_NOT_ALLOWED_ON_MACHINE');
    for (const [m, t] of [
      ['acm', 4],
      ['mdf', 18],
    ] as const) {
      const [p, prof] = withMaterial(m, t);
      expect(codes(p, prof)).not.toContain('MATERIAL_NOT_ALLOWED_ON_MACHINE');
    }
  });
});

describe('edge band on a kind without band (T349)', () => {
  function banded(material: string): Project {
    const p = goldenProject(shelfSet, 8);
    p.stock = { ...p.stock, material };
    p.settings = { dimensionMode: 'finished' };
    p.parts = p.parts.map((part) => ({
      ...part,
      edgeBand: { top: 2, right: 0, bottom: 2, left: 0 },
    }));
    return p;
  }

  it('MDF deducts the band; ACM keeps the values but reads sizes as cut sizes', () => {
    const mdf = banded('mdf');
    expect(effectiveDimensionMode(mdf)).toBe('finished');
    expect(projectNotices(mdf)).toEqual([]);
    const acm = banded('acm');
    expect(effectiveDimensionMode(acm)).toBe('cut');
    expect(acm.settings.dimensionMode).toBe('finished');
    const notice = projectNotices(acm);
    expect(notice.map((i) => [i.code, i.severity])).toEqual([['EDGE_BAND_IGNORED', 'info']]);
    // validation never lists the notice (counts and "Sorun bulunmadı" unchanged)
    expect(validateProject(acm).map((i) => i.code)).not.toContain('EDGE_BAND_IGNORED');
  });

  it('report: ACM prints no band and finished = cut; back on MDF the sizes return exactly', () => {
    const acm = banded('acm');
    const part = acm.parts[0];
    if (!part || part.kind !== 'rect') throw new Error('rect part');
    const rAcm = projectReport(acm).parts[0];
    expect(rAcm?.bandedEdges).toEqual([]);
    expect(rAcm?.finished).toEqual({ w: part.params.w, h: part.params.h });
    expect(rAcm?.cut).toEqual({ w: part.params.w, h: part.params.h });
    const mdf = { ...acm, stock: { ...acm.stock, material: 'mdf' } };
    const rMdf = projectReport(mdf).parts[0];
    const cut = cutPart(part, 'finished');
    expect(rMdf?.bandedEdges).toEqual(['top', 'bottom']);
    expect(rMdf?.cut.h).toBe(cut.kind === 'rect' ? cut.params.h : NaN);
    expect(mdf.parts[0]?.edgeBand).toEqual({ top: 2, right: 0, bottom: 2, left: 0 });
  });
});
