import { describe, expect, it } from 'vitest';
import { unverifiedMaterialName } from '../export/export';
import { checkGcode } from '../gcode-check/check';
import { goldenTray, postConfig } from '../gcode-check/check.testing';
import { verificationFamilyOf } from '../machine/material-traits';
import { vGrooveProfile } from '../post/golden.testing';
import type { PostProfileVersion } from '../post';
import { evaluateTrayCut, foldedOuterSize, trayTestProgram } from './tray';

// T356 (§7.3, D-138): verification per material family, the ACM tray test part, and the CTO #15
// rider: the checker requires the "DOGRULANMAMIS MALZEME" line while the family is unverified.

const version = (verification: PostProfileVersion['verification']): PostProfileVersion => ({
  profile: vGrooveProfile('generic'),
  version: 1,
  verification,
});

describe('verification family (T356)', () => {
  it('wood and plastic share the board record; ACM and aluminium have their own', () => {
    expect(verificationFamilyOf('mdf')).toBe('woodBoard');
    expect(verificationFamilyOf('acrylic')).toBe('woodBoard');
    expect(verificationFamilyOf(null)).toBe('woodBoard');
    expect(verificationFamilyOf('acm')).toBe('composite');
    expect(verificationFamilyOf('aluminium')).toBe('nonFerrous');
  });

  it('the material line stays until the family has a passed test cut', () => {
    const acm = { stock: { material: 'acm' } } as never;
    expect(unverifiedMaterialName(acm)).toBe('ACM');
    expect(unverifiedMaterialName(acm, 'draft')).toBe('ACM');
    expect(unverifiedMaterialName(acm, 'test_cut_approved')).toBe('ACM');
    expect(unverifiedMaterialName(acm, 'verified')).toBeUndefined();
    expect(
      unverifiedMaterialName({ stock: { material: 'mdf' } } as never, 'draft'),
    ).toBeUndefined();
  });
});

describe('checker: DOGRULANMAMIS MALZEME header (T356 rider, CTO #15)', () => {
  const tray = goldenTray('generic');
  const ctx = { ...tray.context, unverifiedMaterial: 'ACM' };
  const codes = (text: string, c = ctx) => checkGcode(text, c).violations.map((v) => v.code);

  it('accepts the golden tray, which carries the line', () => {
    expect(codes(tray.text)).not.toContain('UNVERIFIED_MATERIAL_HEADER_MISSING');
  });

  it('mutation: removing the line is caught and the file cannot be downloaded', () => {
    const cut = tray.text
      .split('\r\n')
      .filter((l) => !l.includes('DOGRULANMAMIS MALZEME'))
      .join('\r\n');
    expect(cut).not.toBe(tray.text);
    const r = checkGcode(cut, ctx);
    expect(r.ok).toBe(false);
    expect(codes(cut)).toContain('UNVERIFIED_MATERIAL_HEADER_MISSING');
    // silent when the family is verified (no expectation in the context)
    expect(codes(cut, tray.context)).not.toContain('UNVERIFIED_MATERIAL_HEADER_MISSING');
  });

  it('mutation: the line moved below the first code line, or naming another material, is caught', () => {
    const lines = tray.text.split('\r\n').filter((l) => !l.includes('DOGRULANMAMIS MALZEME'));
    const g = lines.findIndex((l) => l.startsWith('G21'));
    const moved = [...lines];
    moved.splice(g + 1, 0, '(DOGRULANMAMIS MALZEME: ACM)');
    expect(codes(moved.join('\r\n'))).toContain('UNVERIFIED_MATERIAL_HEADER_MISSING');
    const other = tray.text.replace('DOGRULANMAMIS MALZEME: ACM', 'DOGRULANMAMIS MALZEME: MDF');
    expect(codes(other)).toContain('UNVERIFIED_MATERIAL_HEADER_MISSING');
  });
});

describe('ACM tray test program (T356)', () => {
  it('test cut: grooves, outline, the unverified lines; passes every check', () => {
    const r = trayTestProgram('testCut', version('draft'), postConfig('generic'));
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.check?.ok).toBe(true);
    const text = r.files.map((f) => f.content).join('\n');
    expect(text).toContain('DOGRULANMAMIS MALZEME: ACM');
    expect(text).toContain('DOGRULANMADI, once air cut');
    expect(r.info).toMatchObject({ material: 'acm', vBit: 7, vAngle: 90, remaining: 0.8 });
    expect(r.info?.foldedOuter).toBe(foldedOuterSize(200, 0.8, 0.2));
    // deterministic
    const again = trayTestProgram('testCut', version('draft'), postConfig('generic'));
    expect(again.files.map((f) => f.content)).toEqual(r.files.map((f) => f.content));
  });

  it('air cut: passes, never below the gap, still names the material', () => {
    const r = trayTestProgram('airCut', version('draft'), postConfig('generic'));
    expect(r.ok).toBe(true);
    expect(r.files[0]?.content).toContain('DOGRULANMAMIS MALZEME: ACM');
    expect(r.files[0]?.content).toContain('AIR CUT');
  });

  it('no V-bit or no ACM set: an issue, no files', () => {
    const noVBit = version('draft');
    noVBit.profile = {
      ...noVBit.profile,
      tools: noVBit.profile.tools.filter((t) => t.type !== 'vBit'),
    };
    const r = trayTestProgram('testCut', noVBit, postConfig('generic'));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(['TEST_TOOL_MISSING']);
    const noSet = version('draft');
    noSet.profile = {
      ...noSet.profile,
      materials: noSet.profile.materials.filter((m) => m.material !== 'acm'),
    };
    expect(trayTestProgram('airCut', noSet, postConfig('generic')).issues[0]?.code).toBe(
      'NO_MATERIAL_SET',
    );
  });

  it('folded outer size follows analysis §4.6 (400 mm span → 400,97 mm)', () => {
    expect(foldedOuterSize(400, 0.8, 0.2)).toBe(400.97);
  });

  it('evaluation: remaining ± 0,1 and outer ± 0,5; form errors', () => {
    const info = { remaining: 0.8, foldedOuter: 200.97 };
    const ok = evaluateTrayCut({ remaining: 0.85, outerX: 201.2, outerY: 200.6 }, info);
    expect(ok.valid).toBe(true);
    expect(ok.inTolerance).toBe(true);
    const bad = evaluateTrayCut({ remaining: 0.65, outerX: 201, outerY: 201 }, info);
    expect(bad.inTolerance).toBe(false);
    expect(bad.items.find((i) => i.key === 'remaining')?.deviation).toBe(-0.15);
    const form = evaluateTrayCut({ remaining: 'x', outerY: 5000 }, info);
    expect(form.valid).toBe(false);
    expect(form.issues.map((i) => i.code).sort()).toEqual([
      'IMPLAUSIBLE',
      'MISSING',
      'NOT_A_NUMBER',
    ]);
  });
});
