import { describe, expect, it } from 'vitest';
import { checkGcode } from '../gcode-check/check';
import { goldenTray, postConfig } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import type { Project } from '../schema';
import { exportNc } from './export';

// B72 tester (T355, T356 rider; G-code safety §7.2): the new "MALZEME:" words are user text in a
// comment; they must never leave the comment. The unverified-material line follows the family.

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

const run = (p: Project, profile: MachineProfile, verification: 'draft' | 'verified') =>
  exportNc(p, { profile, version: 1, verification }, postConfig('mach3'));

describe('B72 tester: colour code cannot break out of the header comment', () => {
  for (const colorCode of [
    ') G0 Z-50 (',
    'RAL 9006)\nG0 Z-50\n(',
    'RAL 9006\r\nM3 S24000',
    '%',
    'ÇĞÜŞİ ıöü ®',
  ]) {
    it(`colour code ${JSON.stringify(colorCode)}`, () => {
      const [p, profile] = acm({ colorCode });
      const r = run(p, profile, 'draft');
      expect(r.postErrors).toEqual([]);
      const text = r.files[0]?.content ?? '';
      expect(text).not.toBe('');
      const lines = text.split(/\r\n|\r|\n/);
      // Every line naming MALZEME is one whole comment; no injected code line anywhere.
      for (const l of lines.filter((x) => x.includes('MALZEME:')))
        expect(l, l).toMatch(/^\([^()]*\)$/);
      expect(lines.filter((l) => /Z-50|S24000/.test(l) && !l.startsWith('('))).toEqual([]);
      expect(lines.filter((l) => l.trim() === '%').length).toBeLessThanOrEqual(2);
      expect(text).toMatch(/^[\x20-\x7E\r\n]*$/); // Mach3 is ASCII only
      expect(r.ok, JSON.stringify(r.check).slice(0, 400)).toBe(true);
    });
  }

  it('a very long colour code still gives a checked file', () => {
    const [p, profile] = acm({ colorCode: 'X'.repeat(500) });
    const r = run(p, profile, 'draft');
    const text = r.files[0]?.content ?? '';
    const longest = Math.max(...text.split(/\r\n|\n/).map((l) => l.length));
    // Either refused cleanly or written; never a crash. Record the longest line for the report.
    expect(r.postErrors.length > 0 || text.length > 0).toBe(true);
    expect(longest).toBeGreaterThan(0);
  });

  it('the material line follows the family state: draft has it, verified not; wood never', () => {
    const [p, profile] = acm({ colorCode: 'RAL 9006' });
    expect(run(p, profile, 'draft').files[0]?.content).toContain('DOGRULANMAMIS MALZEME: ACM');
    const v = run(p, profile, 'verified');
    expect(v.postErrors).toEqual([]);
    for (const f of v.files) expect(f.content).not.toContain('DOGRULANMAMIS MALZEME');
    const wood = goldenProject(shelfSet, 8);
    const w = exportNc(
      wood,
      { profile: goldenProfile('mach3'), version: 1, verification: 'draft' },
      postConfig('mach3'),
    );
    for (const f of w.files) expect(f.content).not.toContain('DOGRULANMAMIS MALZEME');
  });
});

describe('B72 tester: checker variants of the unverified-material line', () => {
  const tray = goldenTray('generic');
  const ctx = { ...tray.context, unverifiedMaterial: 'ACM' };
  const caught = (text: string) =>
    checkGcode(text, ctx).violations.some((v) => v.code === 'UNVERIFIED_MATERIAL_HEADER_MISSING');

  it('renamed key, emptied name, or turned into code is caught', () => {
    const at = 'DOGRULANMAMIS MALZEME: ACM';
    expect(tray.text).toContain(at);
    expect(caught(tray.text.replace(at, 'DOGRULANMIS MALZEME: ACM'))).toBe(true);
    expect(caught(tray.text.replace(at, 'DOGRULANMAMIS MALZEME:'))).toBe(true);
    expect(caught(tray.text.replace(at, 'MALZEME: ACM'))).toBe(true);
    expect(caught(tray.text.replace(`(${at})`, ''))).toBe(true);
  });

  it('the line moved to the end of the file is caught; Turkish letters in it are accepted', () => {
    const lines = tray.text.split('\r\n');
    const i = lines.findIndex((l) => l.includes('DOGRULANMAMIS MALZEME'));
    const [line] = lines.splice(i, 1);
    lines.splice(lines.length - 1, 0, line ?? '');
    expect(caught(lines.join('\r\n'))).toBe(true);
    expect(caught(tray.text.replace('DOGRULANMAMIS MALZEME', 'DOĞRULANMAMIŞ MALZEME'))).toBe(false);
  });
});
