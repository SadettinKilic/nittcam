/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate raw JSON freely to build invalid projects */
import { describe, expect, it } from 'vitest';
import cabinetDoors from './__fixtures__/cabinet-doors.json';
import mixed from './__fixtures__/mixed.json';
import shelfSet from './__fixtures__/shelf-set.json';
import { parseProject, type ProjectIssue } from './index';

const fixtures = { cabinetDoors, shelfSet, mixed } as const;

/** Deep copy of a fixture as mutable raw JSON. */
function clone(json: unknown): any {
  return JSON.parse(JSON.stringify(json));
}

/** Raw JSON helper: the cabinet-doors fixture with `mutate` applied. */
function variant(mutate: (json: any) => void): unknown {
  const json = clone(cabinetDoors);
  mutate(json);
  return json;
}

function issuesOf(json: unknown): ProjectIssue[] {
  const result = parseProject(json);
  if (result.ok) throw new Error('expected the project to be rejected');
  return result.issues;
}

function expectIssue(json: unknown, path: string, message?: RegExp): void {
  const issues = issuesOf(json);
  const match = issues.find((i) => i.path === path);
  expect(match, `no issue at ${path}; got ${JSON.stringify(issues)}`).toBeDefined();
  if (message) expect(match?.message).toMatch(message);
}

describe('fixtures', () => {
  it.each(Object.entries(fixtures))('%s validates', (_name, json) => {
    const result = parseProject(json);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('cabinet doors: 4 doors with 35 mm hinge pockets', () => {
    const result = parseProject(cabinetDoors);
    if (!result.ok) throw new Error('fixture invalid');
    const doors = result.project.parts;
    expect(doors.reduce((n, p) => n + p.qty, 0)).toBe(4);
    for (const door of doors) {
      expect(door.holes.length).toBeGreaterThan(0);
      for (const hole of door.holes) expect(hole).toMatchObject({ type: 'pocket', d: 35 });
    }
  });

  it('mixed: freeform part with an inner contour, a through hole and a groove', () => {
    const result = parseProject(mixed);
    if (!result.ok) throw new Error('fixture invalid');
    const freeform = result.project.parts.find((p) => p.kind === 'freeform');
    expect(freeform?.inners.length).toBeGreaterThan(0);
    const types = freeform?.holes.map((h) => h.type);
    expect(types).toContain('through');
    expect(types).toContain('groove');
  });

  it('parsing does not mutate the input', () => {
    const json = clone(mixed);
    const before = JSON.stringify(json);
    parseProject(json);
    expect(JSON.stringify(json)).toBe(before);
  });
});

describe('invalid projects are rejected with readable paths', () => {
  it('negative size', () => {
    expectIssue(
      variant((j) => (j.parts[0].params.w = -10)),
      'parts[0].params.w',
      /positive length in mm/,
    );
    expectIssue(
      variant((j) => (j.stock.thickness = 0)),
      'stock.thickness',
      /positive/,
    );
    expectIssue(
      variant((j) => (j.parts[0].holes[0].d = -35)),
      'parts[0].holes[0].d',
      /positive/,
    );
  });

  it('qty 0 and non-integer qty', () => {
    expectIssue(
      variant((j) => (j.parts[1].qty = 0)),
      'parts[1].qty',
      />= 1/,
    );
    expectIssue(
      variant((j) => (j.parts[1].qty = 1.5)),
      'parts[1].qty',
      /integer/,
    );
  });

  it('unknown hole type', () => {
    expectIssue(
      variant((j) => (j.parts[0].holes[1].type = 'countersink')),
      'parts[0].holes[1].type',
      /unknown hole type/,
    );
  });

  it('hole fields depend on the type', () => {
    // pocket needs depth
    expectIssue(
      variant((j) => delete j.parts[0].holes[0].depth),
      'parts[0].holes[0].depth',
    );
    // groove needs grooveWidth
    expectIssue(
      variant(
        (j) => (j.parts[0].holes[0] = { type: 'groove', d: 40, cx: 50, cy: 50, depth: 3, tool: 1 }),
      ),
      'parts[0].holes[0].grooveWidth',
    );
    // through has no depth (it comes from stock + machine)
    const issues = issuesOf(
      variant(
        (j) => (j.parts[0].holes[0] = { type: 'through', d: 8, cx: 5, cy: 5, depth: 3, tool: 1 }),
      ),
    );
    expect(issues.some((i) => i.path.startsWith('parts[0].holes[0]'))).toBe(true);
  });

  it('missing schemaVersion', () => {
    expectIssue(
      variant((j) => delete j.schemaVersion),
      'schemaVersion',
      /missing/,
    );
  });

  it('future schemaVersion', () => {
    expectIssue(
      variant((j) => (j.schemaVersion = 99)),
      'schemaVersion',
      /newer/,
    );
  });

  it('bad schemaVersion and non-object input', () => {
    expectIssue(
      variant((j) => (j.schemaVersion = '1')),
      'schemaVersion',
      /integer/,
    );
    expectIssue(
      variant((j) => (j.schemaVersion = 0)),
      'schemaVersion',
      /integer >= 1/,
    );
    expectIssue(null, '(root)', /JSON object/);
    expectIssue([], '(root)', /JSON object/);
  });

  it('grain other than 0 or 90', () => {
    expectIssue(
      variant((j) => (j.stock.sheet.grain = 45)),
      'stock.sheet.grain',
      /0 or 90/,
    );
  });

  it('corner radius larger than half the shorter side', () => {
    expectIssue(
      variant((j) => (j.parts[0].params.r = 300)),
      'parts[0].params.r',
      /half/,
    );
  });

  it('unknown part kind and unknown keys', () => {
    expectIssue(
      variant((j) => (j.parts[0].kind = 'circle')),
      'parts[0].kind',
      /unknown part kind/,
    );
    const issues = issuesOf(variant((j) => (j.parts[0].colour = 'red')));
    expect(issues.some((i) => i.path === 'parts[0]' && /colour/.test(i.message))).toBe(true);
  });

  it('freeform contour needs enough vertices', () => {
    const json = clone(mixed);
    json.parts[0].outline = [{ x: 0, y: 0, bulge: 0 }];
    expect(issuesOf(json).some((i) => i.path === 'parts[0].outline')).toBe(true);
    json.parts[0].outline = [
      { x: 0, y: 0, bulge: 0 },
      { x: 10, y: 0, bulge: 0 },
    ];
    expectIssue(json, 'parts[0].outline', /arc/);
  });

  it('broken cross-references', () => {
    expectIssue(
      variant((j) => (j.parts[1].id = 'door-left')),
      'parts[1].id',
      /duplicate/,
    );
    expectIssue(
      variant((j) => (j.layout.sheets[0].placements[0].partId = 'ghost')),
      'layout.sheets[0].placements[0].partId',
      /unknown part/,
    );
    expectIssue(
      variant((j) => (j.layout.sheets[0].placements[1].index = 2)),
      'layout.sheets[0].placements[1].index',
      /out of range/,
    );
    expectIssue(
      variant((j) => (j.layout.sheets[0].placements[1].index = 0)),
      'layout.sheets[0].placements[1]',
      /more than once/,
    );
  });

  it('every issue has a non-empty path and message', () => {
    const issues = issuesOf(
      variant((j) => {
        j.parts[0].qty = 0;
        j.parts[0].params.h = -1;
        j.nesting.mode = 'random';
      }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(3);
    for (const issue of issues) {
      expect(issue.path).not.toBe('');
      expect(issue.message).not.toBe('');
    }
  });
});
