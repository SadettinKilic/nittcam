import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, type Project } from '../schema';
import { marginBelowToolRadius, minSheetMargin, validateProject } from './index';

// T300 (CTO #12 E1, D-085), T331 (D-122): a sheet margin below the tool diameter is a warning on
// Dizilim (the cutter's far edge lies one diameter outside the part).

function withMargin(margin: number): Project {
  const json = JSON.parse(JSON.stringify(cabinetDoors));
  json.nesting.margin = margin;
  const result = parseProject(json);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

describe('marginBelowToolRadius (T300)', () => {
  it('minSheetMargin is the tool diameter, 0 without a tool', () => {
    expect(minSheetMargin(8)).toBe(8);
    expect(minSheetMargin(6.35)).toBeCloseTo(6.35);
    expect(minSheetMargin(0)).toBe(0);
  });

  it.each([
    [0, true],
    [4, true],
    [7.998, true],
    [7.9995, false],
    [8, false],
    [10, false],
  ])('margin %s mm with a Ø8 tool → warning %s', (margin, warned) => {
    const issues = marginBelowToolRadius(withMargin(margin), { toolDiameter: 8 });
    expect(issues.length > 0).toBe(warned);
    for (const i of issues) {
      expect(i).toMatchObject({
        code: 'MARGIN_BELOW_TOOL_RADIUS',
        severity: 'warning',
        path: 'nesting.margin',
      });
    }
  });

  it('is skipped without a tool and never blocks the export', () => {
    expect(marginBelowToolRadius(withMargin(0), {})).toEqual([]);
    const all = validateProject(withMargin(0), { toolDiameter: 8 });
    expect(all.some((i) => i.code === 'MARGIN_BELOW_TOOL_RADIUS')).toBe(true);
    expect(
      all.filter((i) => i.code === 'MARGIN_BELOW_TOOL_RADIUS' && i.severity === 'error'),
    ).toEqual([]);
  });
});
