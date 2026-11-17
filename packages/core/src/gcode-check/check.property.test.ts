/**
 * Property (T019): random projects → buildToolpath → generateGcode → checkGcodeFiles = ok with zero
 * violations, for both posts, 4 corners (also with axes pointing away from the table), both Z
 * references, a second tool, split files, the "none" tool-change mode and arcs on or off.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canDownload, checkGcodeFiles } from './check';
import { buildScenario, fileList, scenarioArb } from './scenario.testing';

describe('generated programs pass every check', () => {
  it('random projects, both posts, 4 corners, 2 Z references', () => {
    const seen = { programs: 0, generic: 0, mach3: 0, split: 0, none: 0, twoTools: 0, corners: new Set<string>(), zRefs: new Set<string>() };
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const b = buildScenario(s);
        fc.pre(b !== null);
        if (!b) return;
        // The only legitimate refusal here: one operation larger than the split size.
        fc.pre(!b.result.errors.some((e) => e.code === 'FILE_TOO_LARGE'));
        expect(b.result.errors).toEqual([]);
        const r = checkGcodeFiles(fileList(b.result.files), b.context);
        expect(r.violations).toEqual([]);
        expect(r.ok).toBe(true);
        expect(canDownload(r)).toBe(true);
        const cut = r.files.reduce((n, f) => n + f.result.summary.matchedOperations, 0);
        expect(cut).toBe(b.toolpath.operations.length);
        seen.programs += b.result.files.length;
        seen[s.post]++;
        if (b.result.files.some((f) => f.parts > 1)) seen.split++;
        if (s.files === 'none') seen.none++;
        if (s.twoTools && b.toolpath.operations.length > 1) seen.twoTools++;
        seen.corners.add(s.corner);
        seen.zRefs.add(s.zRef);
      }),
      { numRuns: Number(process.env.FC_RUNS ?? 150) },
    );
    expect(seen.generic).toBeGreaterThan(10);
    expect(seen.mach3).toBeGreaterThan(10);
    expect(seen.corners.size).toBe(4);
    expect(seen.zRefs.size).toBe(2);
    expect(seen.twoTools).toBeGreaterThan(5);
    expect(seen.none).toBeGreaterThan(5);
  }, 180_000);
});
