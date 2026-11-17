/**
 * Test-cut measurement form → tolerance check → correction suggestion (spec §7.3; T022, D-031).
 *
 * The user measures the cut test part with a caliper: the two edges, a diagonal, the hole diameter
 * and the pocket depth (the pocket depth catches a Z-zero error). Every value is compared with its
 * nominal within a fixed tolerance; all in tolerance = the profile version may be marked verified.
 * Otherwise a correction is suggested: a tool-diameter correction when the edges and the hole all
 * point to the same tool-size error, a Z-zero correction for the pocket depth, and an axis/squareness
 * hint when the numbers cannot be explained by the tool. Pure.
 */
import type { TestPartInfo } from './program';

/** Tolerances, mm (D-031: the conservative choice; the spec gives no values). */
export const TEST_TOLERANCE = {
  edge: 0.2,
  diagonal: 0.3,
  hole: 0.2,
  pocketDepth: 0.2,
} as const;

/** Plausibility bounds of an entered value, mm (catches typos such as 2000 for 200.0). */
const PLAUSIBLE = { min: 0.1, max: 1000 } as const;

export interface TestCutMeasurements {
  /** Edge along X, mm. */
  edgeX: number;
  /** Edge along Y, mm. */
  edgeY: number;
  /** One corner-to-corner diagonal, mm. */
  diagonal: number;
  holeDiameter: number;
  pocketDepth: number;
  /**
   * Measured stock thickness, mm. Required when Z zero is the table: the pocket is then cut to a
   * height above the table, so its depth from the real top depends on the real thickness.
   */
  thickness?: number;
}

export type MeasurementKey = 'edgeX' | 'edgeY' | 'diagonal' | 'holeDiameter' | 'pocketDepth';

export interface MeasurementItem {
  key: MeasurementKey;
  nominal: number;
  measured: number;
  /** measured − nominal. */
  deviation: number;
  tolerance: number;
  ok: boolean;
}

export type TestCutSuggestion =
  /** Set the tool's diameter in the profile from `from` to `to` (mm). */
  | { kind: 'toolDiameter'; tool: number; from: number; to: number }
  /** The pocket is `amount` mm too deep (`up`: raise Z zero) or too shallow (`down`: lower it). */
  | { kind: 'zZero'; direction: 'up' | 'down'; amount: number }
  /** Edges and hole disagree: not a tool-size error; check the axis calibration (steps/mm), play. */
  | { kind: 'axisScale'; edgeX: number; edgeY: number; hole: number }
  /** The diagonal does not fit the measured edges: the axes are not square to each other. */
  | { kind: 'squareness'; deviation: number };

export type MeasurementIssueCode = 'MISSING' | 'NOT_A_NUMBER' | 'IMPLAUSIBLE';

export interface MeasurementIssue {
  field: keyof TestCutMeasurements;
  code: MeasurementIssueCode;
}

export interface TestCutEvaluation {
  /** False when the form itself is invalid (`issues`); nothing is evaluated then. */
  valid: boolean;
  issues: MeasurementIssue[];
  items: MeasurementItem[];
  /** Every item within tolerance → the profile version may be marked verified. */
  inTolerance: boolean;
  suggestions: TestCutSuggestion[];
}

/** Rounds to 0.01 mm for display and suggestions (no float noise such as 0.30000000000000004). */
function r2(v: number): number {
  return Math.round(v * 100) / 100 + 0;
}

function validate(m: Partial<Record<keyof TestCutMeasurements, unknown>>, needThickness: boolean) {
  const issues: MeasurementIssue[] = [];
  const fields: (keyof TestCutMeasurements)[] = [
    'edgeX',
    'edgeY',
    'diagonal',
    'holeDiameter',
    'pocketDepth',
  ];
  if (needThickness || m.thickness !== undefined) fields.push('thickness');
  for (const field of fields) {
    const v = m[field];
    if (v === undefined || v === null || v === '') issues.push({ field, code: 'MISSING' });
    else if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push({ field, code: 'NOT_A_NUMBER' });
    } else if (v < PLAUSIBLE.min || v > PLAUSIBLE.max) {
      issues.push({ field, code: 'IMPLAUSIBLE' });
    }
  }
  return issues;
}

/**
 * Evaluates the measurement form against the test part the program cut (`info`).
 *
 * Tool diameter: an outer edge loses (D_real − D_profile) and the hole gains it, so each gives an
 * estimate (nominal − edge, hole − nominal). When any of the three is out of tolerance and the
 * three estimates agree within the edge tolerance, the tool is the cause: the suggestion is the
 * profile diameter plus their mean. When they disagree, an axis-scale hint is given instead.
 */
export function evaluateTestCut(
  input: Partial<Record<keyof TestCutMeasurements, unknown>>,
  info: Pick<
    TestPartInfo,
    'edge' | 'holeDiameter' | 'pocketDepth' | 'thickness' | 'tool' | 'toolDiameter' | 'zReference'
  >,
): TestCutEvaluation {
  const needThickness = info.zReference === 'table';
  const issues = validate(input, needThickness);
  if (issues.length > 0) {
    return { valid: false, issues, items: [], inTolerance: false, suggestions: [] };
  }
  const m = input as TestCutMeasurements;
  // With Z zero on the table the pocket bottom sits at (t_nominal − depth) above the table, so
  // from the real top it is depth + (t_real − t_nominal) deep.
  const pocketNominal =
    needThickness && m.thickness !== undefined
      ? info.pocketDepth + (m.thickness - info.thickness)
      : info.pocketDepth;
  const item = (key: MeasurementKey, nominal: number, tolerance: number): MeasurementItem => {
    const measured = m[key];
    const deviation = measured - nominal;
    return {
      key,
      nominal: r2(nominal),
      measured,
      deviation: r2(deviation),
      tolerance,
      ok: Math.abs(deviation) <= tolerance + 1e-9,
    };
  };
  const items = [
    item('edgeX', info.edge, TEST_TOLERANCE.edge),
    item('edgeY', info.edge, TEST_TOLERANCE.edge),
    item('diagonal', Math.hypot(info.edge, info.edge), TEST_TOLERANCE.diagonal),
    item('holeDiameter', info.holeDiameter, TEST_TOLERANCE.hole),
    item('pocketDepth', pocketNominal, TEST_TOLERANCE.pocketDepth),
  ];
  const ok = (k: MeasurementKey) => items.find((i) => i.key === k)?.ok ?? false;
  const suggestions: TestCutSuggestion[] = [];

  // Size: tool diameter or axis scale.
  if (!ok('edgeX') || !ok('edgeY') || !ok('holeDiameter')) {
    const estimates = [
      info.edge - m.edgeX,
      info.edge - m.edgeY,
      m.holeDiameter - info.holeDiameter,
    ];
    const spread = Math.max(...estimates) - Math.min(...estimates);
    const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
    const to = r2(info.toolDiameter + mean);
    if (spread <= TEST_TOLERANCE.edge + 1e-9 && to > 0) {
      suggestions.push({ kind: 'toolDiameter', tool: info.tool, from: info.toolDiameter, to });
    } else {
      suggestions.push({
        kind: 'axisScale',
        edgeX: r2(m.edgeX - info.edge),
        edgeY: r2(m.edgeY - info.edge),
        hole: r2(m.holeDiameter - info.holeDiameter),
      });
    }
  }
  // Squareness: the diagonal against the one the measured edges give. Also when the diagonal is
  // the only thing out of tolerance (it cannot then come from the size).
  const squareDev = m.diagonal - Math.hypot(m.edgeX, m.edgeY);
  if (
    !ok('diagonal') &&
    (Math.abs(squareDev) > TEST_TOLERANCE.diagonal + 1e-9 || suggestions.length === 0)
  ) {
    suggestions.push({ kind: 'squareness', deviation: r2(squareDev) });
  }
  // Z zero from the pocket depth.
  const pocket = items.find((i) => i.key === 'pocketDepth');
  if (pocket && !pocket.ok) {
    suggestions.push({
      kind: 'zZero',
      direction: pocket.deviation > 0 ? 'up' : 'down',
      amount: r2(Math.abs(pocket.deviation)),
    });
  }
  return {
    valid: true,
    issues: [],
    items,
    inTolerance: items.every((i) => i.ok),
    suggestions,
  };
}
