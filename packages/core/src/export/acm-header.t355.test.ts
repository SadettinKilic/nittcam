import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { propsNcDetail } from '../machine/material-props-fields';
import type { MachineProfile } from '../machine';
import {
  goldenProfile,
  goldenProject,
  vGrooveProfile,
  vGrooveTrayProject,
} from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import type { Project } from '../schema';
import { vGrooveChecklistOf } from '../toolpath/vgroove';
import { exportNc } from './export';

// T355 (analysis §5.6): the "MALZEME:" header line names the stock's identifying properties (ACM
// colour code, aluminium alloy and temper) when it has them; programs without them are unchanged.

function acm(props?: Project['stock']['props']): [Project, MachineProfile] {
  const p = goldenProject(shelfSet, 8);
  p.stock = { ...p.stock, material: 'acm', thickness: 4, ...(props ? { props } : {}) };
  const profile = goldenProfile('mach3');
  const base = profile.materials[0];
  if (!base) throw new Error('no material set');
  profile.materials = [
    ...profile.materials,
    {
      ...base,
      material: 'acm',
      thickness: 4,
      stepDown: Math.min(base.stepDown, 4),
      tabs: undefined,
    },
  ];
  return [p, profile];
}

const materialLine = (r: ReturnType<typeof exportNc>) =>
  r.files[0]?.content.split('\n').find((l) => l.startsWith('(MALZEME: '));

describe('MALZEME header line (T355)', () => {
  it('props words per family; wood and plastic never get any', () => {
    expect(propsNcDetail('acm', { colorCode: ' RAL  9006 ' })).toBe('RAL 9006');
    expect(propsNcDetail('aluminium', { alloy: '5754', temper: 'H22', finish: 'brushed' })).toBe(
      '5754 H22',
    );
    expect(propsNcDetail('mdf', { colorCode: 'X', alloy: '5754' } as never)).toBe('');
    expect(propsNcDetail('acm', undefined)).toBe('');
    expect(propsNcDetail('acm', {})).toBe('');
  });

  it('ACM with a colour code names it after the thickness; without props the line is as before', () => {
    const [p, profile] = acm({ colorCode: 'RAL 9006' });
    const r = exportNc(p, { profile, version: 1, verification: 'draft' }, postConfig('mach3'));
    expect(r.postErrors).toEqual([]);
    expect(materialLine(r)).toMatch(/\(MALZEME: acm 4\.000 mm, RAL 9006, plaka /);
    const [q, profile2] = acm();
    const plain = exportNc(
      q,
      { profile: profile2, version: 1, verification: 'draft' },
      postConfig('mach3'),
    );
    expect(materialLine(plain)).toMatch(/\(MALZEME: acm 4\.000 mm, plaka /);
  });
});

describe('V-groove checklist (T355)', () => {
  it('names the V-bit, its angle and the remaining skin of the tray', () => {
    const profile = vGrooveProfile('generic');
    const tray = vGrooveTrayProject(8);
    expect(vGrooveChecklistOf(tray, profile)).toEqual({ tool: 7, angle: 90, remaining: [0.8] });
  });

  it('distinct remaining values ascending; no V-bit = tool null', () => {
    const tray = vGrooveTrayProject(8);
    const part = tray.parts[0];
    const line = part?.lines?.[1];
    if (!part?.lines || !line) throw new Error('no lines');
    part.lines[1] = { ...line, op: { kind: 'vgroove', remaining: 1 } };
    const profile = goldenProfile('generic');
    expect(vGrooveChecklistOf(tray, profile)).toEqual({
      tool: null,
      angle: null,
      remaining: [0.8, 1],
    });
  });

  it('null without grooves (wood, ACM without folds)', () => {
    const profile = vGrooveProfile('generic');
    expect(vGrooveChecklistOf(goldenProject(shelfSet, 8), profile)).toBeNull();
    const tray = vGrooveTrayProject(8);
    tray.parts = tray.parts.map((p) => ({ ...p, lines: [] }));
    expect(vGrooveChecklistOf(tray, profile)).toBeNull();
  });
});
