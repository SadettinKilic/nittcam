import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { goldenProfile } from '../post/golden.testing';
import { operationToolHeaders } from '../post/generate';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { operationToolProblem, operationToolsOf } from './op-tool-choice';
import { operationsInJob, recommendedRpm } from './op-tools';
import { spindleSettingsOf } from './spindle';
import { clone, projectOf } from './toolpath.testing';

// T308 (D-099): the cutting tool per operation (outer / inner / pocket / hole), per job. Default =
// today's tools (goldens unchanged); only suitable tools are offered and accepted; the toolpath,
// the spindle rows, the program header and the G-code checker follow the choice.

enablePatches();

/** The golden generic profile (T1 Ø6, T2 Ø8 flat; MDF 18 set → T2) plus a few more tools. */
function machineWithTools(): MachineProfile {
  const m = goldenProfile('generic');
  m.tools = [
    ...m.tools,
    { number: 3, type: 'drill', diameter: 6, fluteLength: 40, flutes: 2 },
    { number: 4, type: 'compression', diameter: 6, fluteLength: 28, flutes: 2 },
    { number: 5, type: 'vBit', diameter: 6, fluteLength: 30, flutes: 2 },
    { number: 6, type: 'flatEndMill', diameter: 10, fluteLength: 30, flutes: 2 },
    { number: 7, type: 'flatEndMill', diameter: 4, fluteLength: 12, flutes: 2 },
  ];
  // A thinner MDF set that names T1: its rpm is T1's recommendation once T1 is chosen.
  const base = m.materials[0];
  if (!base) throw new Error('no set');
  m.materials = [...m.materials, { ...base, thickness: 12, rpm: 20000, tool: 1 }];
  return m;
}

const machine = machineWithTools();

/** One 300 × 200 part with a Ø6 through hole, a Ø35 hinge pocket and a 10 mm wide slot. */
function project(): Project {
  const base = clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: 1 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
    }),
  ) as Project;
  const part = base.parts[0];
  if (!part) throw new Error('no part');
  part.holes = [
    { type: 'through', id: 'h1', d: 6, cx: 50, cy: 50, tool: 1 },
    { type: 'pocket', id: 'p1', d: 35, cx: 150, cy: 100, tool: 1, depth: 12 },
  ];
  part.inners = [
    [
      { x: 100, y: 40, bulge: 0 },
      { x: 280, y: 40, bulge: 0 },
      { x: 280, y: 50, bulge: 0 },
      { x: 100, y: 50, bulge: 0 },
    ],
  ];
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function run(p: Project, params: unknown): Project {
  const r = applyCommand(p, 'setOperationTool', params, { machine });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(applyPatches(r.project, r.inversePatches)).toEqual(p);
  return r.project;
}

const rowOf = (p: Project, op: string) => {
  const row = operationToolsOf(p, machine).find((r) => r.op === op);
  if (!row) throw new Error(`no ${op} row`);
  return row;
};
const numbers = (p: Project, op: string) => rowOf(p, op).candidates.map((t) => t.number);

describe('operationToolsOf (T308)', () => {
  it('one row per operation of the job, defaults = today', () => {
    const p = project();
    expect(operationsInJob(p)).toEqual(['outer', 'inner', 'pocket', 'hole']);
    expect(rowOf(p, 'outer')).toMatchObject({ defaultTool: 2, chosen: undefined, tool: 2 });
    expect(rowOf(p, 'inner')).toMatchObject({ defaultTool: 2, tool: 2 });
    expect(rowOf(p, 'pocket')).toMatchObject({ defaultTool: 1, tool: 1 });
    expect(rowOf(p, 'hole')).toMatchObject({ defaultTool: 1, tool: 1 });
    const plain = clone(projectOf({ parts: [{ id: 'a', w: 300, h: 200 }] })) as Project;
    expect(operationsInJob(plain)).toEqual(['outer']);
  });

  it('only suitable tools: type, flute length, layout spacing, corners, hole sizes', () => {
    const p = project();
    // vBit / drill never cut a contour; T6 Ø10 is wider than the T2 Ø8 spacing; T7 is too short.
    expect(numbers(p, 'outer')).toEqual([1, 2, 4]);
    expect(operationToolProblem(p, machine, 'outer', 6)).toBe('WIDER_THAN_LAYOUT');
    expect(operationToolProblem(p, machine, 'outer', 7)).toBe('FLUTE_LENGTH');
    expect(operationToolProblem(p, machine, 'outer', 3)).toBe('TYPE');
    // The 10 mm slot takes Ø6 and Ø8 but not Ø10; T7 is too short.
    expect(numbers(p, 'inner')).toEqual([1, 2, 4]);
    expect(operationToolProblem(p, machine, 'inner', 6)).toBe('CONTOUR');
    // Pocket Ø35 × 12: every end mill long enough; T7 (12 mm flutes) just reaches.
    expect(numbers(p, 'pocket')).toEqual([1, 2, 4, 6, 7]);
    // Through hole Ø6: T1 and the Ø6 drill; Ø8 is too wide, the Ø4 end mill too short.
    expect(numbers(p, 'hole')).toEqual([1, 3]);
    expect(operationToolProblem(p, machine, 'hole', 2)).toBe('HOLE_SMALLER');
    expect(operationToolProblem(p, machine, 'hole', 4)).toBe('TYPE');
  });

  it('a drill only drills holes of its own size', () => {
    const p = clone(project()) as Project;
    const h = p.parts[0]?.holes[0];
    if (!h) throw new Error('no hole');
    h.d = 7;
    expect(operationToolProblem(p, machine, 'hole', 3)).toBe('DRILL_SIZE');
    expect(numbers(p, 'hole')).toEqual([1]);
  });
});

describe('setOperationTool (T308)', () => {
  it('stores per operation, null goes back; undo restores byte for byte', () => {
    const p = project();
    const own = run(run(p, { op: 'outer', tool: 1 }), { op: 'hole', tool: 3 });
    expect(own.cutting.tools).toEqual({ outer: 1, hole: 3 });
    const back = run(run(own, { op: 'outer', tool: null }), { op: 'hole', tool: null });
    expect(back.cutting).toEqual(p.cutting);
    expect('tools' in back.cutting).toBe(false);
  });

  it('refuses a tool that does not suit the operation on this job', () => {
    const p = project();
    for (const [op, tool] of [
      ['outer', 5],
      ['outer', 6],
      ['inner', 6],
      ['hole', 2],
      ['pocket', 3],
      ['outer', 42],
    ] as const) {
      const r = applyCommand(p, 'setOperationTool', { op, tool }, { machine });
      expect(r.ok, `${op} T${tool}`).toBe(false);
    }
    expect(applyCommand(p, 'setOperationTool', { op: 'outer', tool: 0 }).ok).toBe(false);
    expect(applyCommand(p, 'setOperationTool', { op: 'side', tool: 1 }).ok).toBe(false);
  });

  it('is a machine setting, not an AI tool', async () => {
    const { COMMANDS } = await import('../commands/registry');
    expect(COMMANDS.setOperationTool.aiTool).toBe(false);
  });
});

describe('toolpath, spindle and program follow the choice (T308)', () => {
  it('default: same operations as before (contours T2, holes their own T1)', () => {
    const r = buildToolpath(project(), machine);
    expect(r.errors).toEqual([]);
    const tools = r.toolpath.operations.map((o) => `${o.kind}:T${o.tool}@${o.rpm}`);
    expect(new Set(tools)).toEqual(
      new Set([
        'drill:T1@18000',
        'pocket:T1@18000',
        'innerContour:T2@18000',
        'outerContour:T2@18000',
      ]),
    );
  });

  it('chosen tools cut their operations; a chosen tool takes its own set rpm', () => {
    let p = project();
    p = run(p, { op: 'outer', tool: 4 });
    p = run(p, { op: 'inner', tool: 1 });
    p = run(p, { op: 'pocket', tool: 6 });
    p = run(p, { op: 'hole', tool: 3 });
    const r = buildToolpath(p, machine);
    expect(r.errors).toEqual([]);
    const byKind = new Map<string, Set<string>>();
    for (const o of r.toolpath.operations) {
      const s = byKind.get(o.kind) ?? new Set();
      s.add(`T${o.tool} D${o.toolDiameter} S${o.rpm}`);
      byKind.set(o.kind, s);
    }
    expect([...(byKind.get('outerContour') ?? [])]).toEqual(['T4 D6 S18000']);
    // T1 is named by the MDF 12 set: 20000 rpm.
    expect([...(byKind.get('innerContour') ?? [])]).toEqual(['T1 D6 S20000']);
    expect([...(byKind.get('pocket') ?? [])]).toEqual(['T6 D10 S18000']);
    expect([...(byKind.get('drill') ?? [])]).toEqual(['T3 D6 S18000']);
    const set = machine.materials[0];
    if (!set) throw new Error('no set');
    expect(recommendedRpm(p, machine, set, 1)).toBe(20000);
    expect(recommendedRpm(project(), machine, set, 1)).toBe(18000);
    // The spindle rows list exactly the job's tools, with the followed recommendation.
    expect(spindleSettingsOf(p, machine).map((s) => [s.tool, s.recommended])).toEqual([
      [1, 20000],
      [3, 18000],
      [4, 18000],
      [6, 18000],
    ]);
  });

  it('the exported program passes the checker and names the choice in the header', () => {
    const exp = (p: Project) => {
      const r = exportNc(
        p,
        { profile: machine, version: 1, verification: 'draft' },
        postConfig('generic'),
      );
      expect(r.ok, JSON.stringify(r.ok ? [] : r)).toBe(true);
      return r.ok ? (r.files[0]?.content ?? '') : '';
    };
    const plain = exp(project());
    expect(plain).not.toMatch(/TAKIM ELLE/);
    const own = exp(
      run(run(run(project(), { op: 'outer', tool: 1 }), { op: 'inner', tool: 1 }), {
        op: 'hole',
        tool: 3,
      }),
    );
    const header = own.split(/\r?\n/).find((l) => l.startsWith('(TAKIM ELLE'));
    expect(header).toBe('(TAKIM ELLE: dis kontur T1, ic kontur T1, delik T3)');
    expect(own).toMatch(/^T3 M6/m);
    expect(own).not.toMatch(/^T2 M6/m);
  });

  it('header wording', () => {
    const base = {
      tabMode: 'small',
      tabCount: 4,
      tabWidth: 10,
      tabHeight: 3,
      skin: null,
      leadIn: 'arc',
      direction: 'climb',
    } as const;
    expect(operationToolHeaders(base)).toEqual([]);
    expect(
      operationToolHeaders({
        ...base,
        tools: [
          { op: 'inner', tool: 1 },
          { op: 'pocket', tool: 4 },
        ],
      }),
    ).toEqual(['TAKIM ELLE: iç kontur T1, cep T4']);
  });

  it('a stale or hand-edited choice is refused by validation and toolpath', () => {
    const p = clone(project()) as Project;
    p.cutting.tools = { outer: 5 };
    expect(validateProject(p, { machine }).map((i) => i.code)).toContain(
      'OPERATION_TOOL_UNSUITABLE',
    );
    const r = buildToolpath(p, machine);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('OPERATION_TOOL_UNSUITABLE');

    // A hole drawn after the choice, smaller than the chosen tool: the hole rule names it.
    const q = run(project(), { op: 'pocket', tool: 6 });
    const small = clone(q) as Project;
    small.parts[0]?.holes.push({
      type: 'pocket',
      id: 'p2',
      d: 8,
      cx: 100,
      cy: 150,
      tool: 1,
      depth: 5,
    });
    const codes = validateProject(small, { machine }).map((i) => i.code);
    expect(codes).toContain('HOLE_SMALLER_THAN_TOOL');
    expect(buildToolpath(small, machine).errors.map((e) => e.code)).toContain(
      'HOLE_SMALLER_THAN_TOOL',
    );
    expect(rowOf(small, 'pocket').problem).toBe('HOLE_SMALLER');

    // A drill chosen for through holes of another size never reaches a program.
    const d = clone(run(project(), { op: 'hole', tool: 3 })) as Project;
    const h = d.parts[0]?.holes[0];
    if (h) h.d = 7;
    expect(buildToolpath(d, machine).errors.map((e) => e.code)).toContain(
      'OPERATION_TOOL_UNSUITABLE',
    );
  });

  it('a choice left for an operation the job does not have is ignored (tester r1)', () => {
    // A plain part: outer contour only, no inner cut, no pocket, no through hole.
    const plain = projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: 1 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
    });
    const ref = buildToolpath(plain, machine);
    expect(ref.errors).toEqual([]);
    // Too short (T7), not in the profile (42), a drill (T3): none of them is used.
    for (const leftover of [
      { inner: 7 },
      { inner: 42 },
      { inner: 3 },
      { pocket: 3 },
      { pocket: 42, hole: 5, inner: 7 },
    ]) {
      const p = clone(plain) as Project;
      p.cutting.tools = leftover;
      const r = buildToolpath(p, machine);
      expect(r.errors, JSON.stringify(leftover)).toEqual([]);
      expect(r.toolpath.operations).toEqual(ref.toolpath.operations);
      const codes = validateProject(p, { machine }).map((i) => i.code);
      expect(codes).not.toContain('OPERATION_TOOL_UNSUITABLE');
      expect(spindleSettingsOf(p, machine).map((s) => s.tool)).toEqual([2]);
      const set = machine.materials[0];
      if (set) expect(recommendedRpm(p, machine, set, 3)).toBe(set.rpm);
      // No row for an absent operation, so nothing to clear in the UI.
      expect(operationToolsOf(p, machine).map((row) => row.op)).toEqual(['outer']);
    }
    // The header names only choices of operations the job has.
    const exp = exportNc(
      Object.assign(clone(plain) as Project, {
        cutting: { ...plain.cutting, tools: { inner: 1, outer: 1 } },
      }),
      { profile: machine, version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(exp.ok).toBe(true);
    const header = (exp.ok ? (exp.files[0]?.content ?? '') : '')
      .split(/\r?\n/)
      .find((l) => l.startsWith('(TAKIM ELLE'));
    expect(header).toBe('(TAKIM ELLE: dis kontur T1)');
  });

  it('a left-over choice comes back into use when its operation does', () => {
    const p = clone(project()) as Project;
    const part = p.parts[0];
    if (!part) throw new Error('no part');
    const inners = part.inners;
    part.inners = [];
    p.cutting.tools = { inner: 1 };
    expect(buildToolpath(p, machine).errors).toEqual([]);
    part.inners = inners;
    const r = buildToolpath(p, machine);
    expect(r.errors).toEqual([]);
    const inner = r.toolpath.operations.filter((o) => o.kind === 'innerContour');
    expect(inner.length).toBeGreaterThan(0);
    expect(new Set(inner.map((o) => o.tool))).toEqual(new Set([1]));
  });
});
