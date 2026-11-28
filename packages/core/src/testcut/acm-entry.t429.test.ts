import { describe, expect, it } from 'vitest';
import { TEST_PART, testPartToolpath, testProgram } from './program';
import { checkGcode } from '../gcode-check/check';
import { postConfig } from '../gcode-check/check.testing';
import { backFaceProfile } from '../post/golden.testing';

/** T429 (D-149): the field-kit test cut follows the material's entry traits and runs rule 12. */
describe('T429: test cut on ACM enters on a helix; rule 12 checks it', () => {
  const profile = backFaceProfile('mach3');
  const idx = profile.materials.findIndex((m) => m.material === 'acm');
  const run = (kind: 'testCut' | 'airCut') =>
    testProgram(kind, { profile, version: 1, verification: 'draft' }, postConfig('mach3'), {
      materialIndex: idx,
    });

  it('test cut and air cut pass every check; the pockets descend on helical arcs', () => {
    for (const kind of ['testCut', 'airCut'] as const) {
      const r = run(kind);
      expect(r.ok, kind).toBe(true);
      expect(r.check?.violations ?? [], kind).toEqual([]);
    }
    const text = run('testCut').files[0]?.content ?? '';
    // a helical arc into the panel: G3 with a Z below the top
    expect(text).toMatch(/G3 X[\d.]+ Y[\d.]+ Z-[\d.]+ I/);
  });

  it('rule 12 refuses a hand-made straight plunge in the test cut', () => {
    const text = run('testCut').files[0]?.content ?? '';
    const m = /\nG3 X[\d.]+ Y[\d.]+ Z(-[\d.]+) I[^\n]*/.exec(text);
    expect(m).not.toBeNull();
    if (!m) return;
    // first helix arc into the panel → a straight G1 down to the same depth
    const mutated = text.replace(m[0], `\nG1 Z${m[1]}`);
    expect(mutated).not.toBe(text);
    const tp = testPartToolpath(profile, { materialIndex: idx });
    if (!tp.toolpath) throw new Error('no toolpath');
    const ctx = {
      profile,
      verification: 'draft' as const,
      post: postConfig('mach3'),
      toolpath: tp.toolpath,
      stock: {
        thickness: 4,
        sheetWidth: TEST_PART.sheet.width,
        sheetHeight: TEST_PART.sheet.height,
      },
      sheet: 0,
      noStraightPlunge: { maxDeg: 5 },
    };
    const r12 = (t: string) => checkGcode(t, ctx).violations.filter((v) => v.rule === 'R12');
    expect(r12(text)).toEqual([]);
    expect(r12(mutated).map((v) => v.code)).toContain('STRAIGHT_PLUNGE_IN_METAL');
  });
});
