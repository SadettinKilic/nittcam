/**
 * T191: the extended field-test program (holes, pocket, groove, arcs, inner contour) through the
 * real post processors and the automatic checks; the air cut never comes below its floor.
 */
import { describe, expect, it } from 'vitest';
import { readGcode } from '../gcode-reader';
import type { MachineProfile } from '../machine';
import { validateProject } from '../validate';
import { goldenProfile, GOLDEN_POSTS } from '../post/golden.testing';
import { AIR_CUT_GAP, type TestProgramKind } from './program';
import { EXTENDED_PART, extendedTestProgram, extendedTestProject } from './extended';

function run(
  kind: TestProgramKind,
  post: 'generic' | 'mach3',
  edit: (p: MachineProfile) => void = () => undefined,
) {
  const profile = goldenProfile(post);
  edit(profile);
  const config = GOLDEN_POSTS.find((p) => p.id === post)?.config;
  return extendedTestProgram(kind, { profile, version: 3, verification: 'draft' }, config);
}

const zs = (text: string) =>
  readGcode(text, { strict: true })
    .moves.filter((m) => m.assumedAxes.length === 0)
    .map((m) => m.to.z);

describe('extended test program (T191)', () => {
  it('the extended part is a valid project', () => {
    const set = goldenProfile('generic').materials[0];
    if (!set) throw new Error('no set');
    const issues = validateProject(extendedTestProject(set, 6)).filter(
      (i) => i.severity === 'error',
    );
    expect(issues).toEqual([]);
  });

  for (const post of ['generic', 'mach3'] as const) {
    it(`${post}: the test cut passes every check and cuts every loop`, () => {
      const r = run('testCut', post);
      expect(r.issues).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.check?.ok).toBe(true);
      expect(r.files).toHaveLength(1);
      const text = r.files[0]?.content ?? '';
      expect(r.files[0]?.name).toContain('TESTPARCA_GENIS');
      expect(text.split('\n')[0]).toContain('DOGRULANMADI');
      // Arcs leave the post as G2/G3.
      expect(text).toMatch(/\bG0?[23]\b/);
      // outline + inner cut-out + 2 through holes
      const summary = r.check?.files[0]?.result.summary;
      expect(summary?.partsExpected).toBe(4);
      expect(summary?.partsCut).toBe(4);
      // The deepest move is a through cut (below the stock bottom), never deeper than the
      // spoilboard allowance allows (the checks enforce it; here only that it went through).
      expect(Math.min(...zs(text))).toBeLessThan(-(r.info?.thickness ?? 0) + 1e-6);
      expect(r.info).toMatchObject({
        width: EXTENDED_PART.width,
        holePitch: EXTENDED_PART.holes.pitch,
        grooveDepth: EXTENDED_PART.groove.depth,
      });
    });

    it(`${post}: the air cut is the same program, never below ${AIR_CUT_GAP} mm`, () => {
      const r = run('airCut', post);
      expect(r.ok).toBe(true);
      expect(r.check?.ok).toBe(true);
      const text = r.files[0]?.content ?? '';
      expect(r.files[0]?.name).toContain('AIRCUT_GENIS');
      expect(Math.min(...zs(text))).toBeGreaterThanOrEqual(AIR_CUT_GAP - 1e-6);
    });
  }

  it('same input, same bytes', () => {
    expect(run('testCut', 'generic').files[0]?.content).toBe(
      run('testCut', 'generic').files[0]?.content,
    );
  });

  it('a tool that does not fit the holes refuses the program', () => {
    const r = run('testCut', 'generic', (p) => {
      for (const t of p.tools) t.diameter = 12;
    });
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.issues.map((i) => i.code)).toContain('TEST_TOOL_TOO_LARGE');
  });

  it('a thin stock refuses the program', () => {
    const r = run('testCut', 'generic', (p) => {
      for (const m of p.materials) m.thickness = 3;
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('TEST_STOCK_TOO_THIN');
  });
});
