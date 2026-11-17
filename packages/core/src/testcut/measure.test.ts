/** T022: test-cut measurement form → tolerance check → correction suggestion. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TEST_TOLERANCE, evaluateTestCut, type TestCutMeasurements } from './measure';

const INFO = {
  edge: 200,
  holeDiameter: 100,
  pocketDepth: 9,
  thickness: 18,
  tool: 2,
  toolDiameter: 8,
  zReference: 'materialTop' as const,
};
const DIAG = Math.hypot(200, 200);

const perfect: TestCutMeasurements = {
  edgeX: 200,
  edgeY: 200,
  diagonal: DIAG,
  holeDiameter: 100,
  pocketDepth: 9,
};

describe('evaluateTestCut', () => {
  it('perfect part: in tolerance, no suggestion', () => {
    const r = evaluateTestCut(perfect, INFO);
    expect(r.valid).toBe(true);
    expect(r.inTolerance).toBe(true);
    expect(r.suggestions).toEqual([]);
    expect(r.items.map((i) => i.key)).toEqual([
      'edgeX',
      'edgeY',
      'diagonal',
      'holeDiameter',
      'pocketDepth',
    ]);
  });

  it('exactly at the tolerance is in, just past it is out', () => {
    expect(
      evaluateTestCut({ ...perfect, edgeX: 200 + TEST_TOLERANCE.edge }, INFO).inTolerance,
    ).toBe(true);
    expect(evaluateTestCut({ ...perfect, edgeX: 200.21 }, INFO).inTolerance).toBe(false);
  });

  it('tool really 8.4 mm: edges 0.4 small, hole 0.4 big → tool diameter 8.4', () => {
    const r = evaluateTestCut(
      { ...perfect, edgeX: 199.6, edgeY: 199.6, holeDiameter: 100.4, diagonal: DIAG - 0.57 },
      INFO,
    );
    expect(r.inTolerance).toBe(false);
    expect(r.suggestions).toEqual([{ kind: 'toolDiameter', tool: 2, from: 8, to: 8.4 }]);
  });

  it('tool really smaller: edges big, hole small → smaller diameter', () => {
    const r = evaluateTestCut({ ...perfect, edgeX: 200.3, edgeY: 200.3, holeDiameter: 99.7 }, INFO);
    expect(r.suggestions[0]).toEqual({ kind: 'toolDiameter', tool: 2, from: 8, to: 7.7 });
  });

  it('edges and hole disagree (only X long) → axis scale hint, no diameter', () => {
    const r = evaluateTestCut({ ...perfect, edgeX: 200.6, diagonal: DIAG + 0.42 }, INFO);
    expect(r.suggestions.map((s) => s.kind)).toEqual(['axisScale']);
    expect(r.suggestions[0]).toEqual({ kind: 'axisScale', edgeX: 0.6, edgeY: 0, hole: 0 });
  });

  it('pocket 0.5 too deep → raise Z zero 0.5; too shallow → lower', () => {
    expect(evaluateTestCut({ ...perfect, pocketDepth: 9.5 }, INFO).suggestions).toEqual([
      { kind: 'zZero', direction: 'up', amount: 0.5 },
    ]);
    expect(evaluateTestCut({ ...perfect, pocketDepth: 8.6 }, INFO).suggestions).toEqual([
      { kind: 'zZero', direction: 'down', amount: 0.4 },
    ]);
  });

  it('diagonal off with good edges → squareness hint', () => {
    const r = evaluateTestCut({ ...perfect, diagonal: DIAG + 0.8 }, INFO);
    expect(r.inTolerance).toBe(false);
    expect(r.suggestions).toEqual([{ kind: 'squareness', deviation: 0.8 }]);
  });

  it('Z zero on the table: thickness required; the real thickness shifts the expected depth', () => {
    const info = { ...INFO, zReference: 'table' as const };
    const missing = evaluateTestCut(perfect, info);
    expect(missing.valid).toBe(false);
    expect(missing.issues).toEqual([{ field: 'thickness', code: 'MISSING' }]);
    // Sheet is 18.4 thick: the pocket bottom is at 9 above the table, so 9.4 deep from the top.
    const ok = evaluateTestCut({ ...perfect, pocketDepth: 9.4, thickness: 18.4 }, info);
    expect(ok.inTolerance).toBe(true);
    const off = evaluateTestCut({ ...perfect, pocketDepth: 9, thickness: 18.4 }, info);
    expect(off.suggestions).toEqual([{ kind: 'zZero', direction: 'down', amount: 0.4 }]);
  });

  it('form validation: missing, not a number, implausible', () => {
    const r = evaluateTestCut(
      { edgeX: 200, edgeY: 'abc', diagonal: 5000, holeDiameter: NaN },
      INFO,
    );
    expect(r.valid).toBe(false);
    expect(r.issues).toEqual([
      { field: 'edgeY', code: 'NOT_A_NUMBER' },
      { field: 'diagonal', code: 'IMPLAUSIBLE' },
      { field: 'holeDiameter', code: 'NOT_A_NUMBER' },
      { field: 'pocketDepth', code: 'MISSING' },
    ]);
    expect(r.inTolerance).toBe(false);
  });

  it('property: in tolerance ⇔ every deviation within its tolerance; deterministic', () => {
    const near = (n: number, spread: number) =>
      fc.double({ min: n - spread, max: n + spread, noNaN: true });
    fc.assert(
      fc.property(
        near(200, 1),
        near(200, 1),
        near(DIAG, 1),
        near(100, 1),
        near(9, 1),
        (edgeX, edgeY, diagonal, holeDiameter, pocketDepth) => {
          const m = { edgeX, edgeY, diagonal, holeDiameter, pocketDepth };
          const r = evaluateTestCut(m, INFO);
          const within =
            Math.abs(edgeX - 200) <= TEST_TOLERANCE.edge + 1e-9 &&
            Math.abs(edgeY - 200) <= TEST_TOLERANCE.edge + 1e-9 &&
            Math.abs(diagonal - DIAG) <= TEST_TOLERANCE.diagonal + 1e-9 &&
            Math.abs(holeDiameter - 100) <= TEST_TOLERANCE.hole + 1e-9 &&
            Math.abs(pocketDepth - 9) <= TEST_TOLERANCE.pocketDepth + 1e-9;
          expect(r.inTolerance).toBe(within);
          // Out of tolerance always comes with at least one suggestion.
          if (!within) expect(r.suggestions.length).toBeGreaterThan(0);
          expect(evaluateTestCut(m, INFO)).toEqual(r);
        },
      ),
      { numRuns: 500 },
    );
  });
});
