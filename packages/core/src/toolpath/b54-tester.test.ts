import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import type { MachineProfile } from '../machine';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { operationToolsOf } from './op-tool-choice';
import { clone, projectOf } from './toolpath.testing';

// B54 tester edge cases (T307 / T308, D-098 / D-099): machine range edges, a machine switch with
// an old override, hand-edited choices that are too short, stale choices for an operation the job
// no longer has, and a property: any offered tool + any in-range rpm exports a checked program
// whose S words stay inside the machine range and follow the chosen tool.

function machineWithTools(): MachineProfile {
  const m = goldenProfile('generic');
  m.tools = [
    ...m.tools,
    { number: 3, type: 'drill', diameter: 6, fluteLength: 40, flutes: 2 },
    { number: 4, type: 'compression', diameter: 6, fluteLength: 28, flutes: 2 },
    { number: 6, type: 'flatEndMill', diameter: 10, fluteLength: 30, flutes: 2 },
    { number: 7, type: 'flatEndMill', diameter: 4, fluteLength: 12, flutes: 2 },
  ];
  return m;
}

const machine = machineWithTools();
const { minRpm, maxRpm } = machine.spindle;

function project(withInner = true): Project {
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
  part.inners = withInner
    ? [
        [
          { x: 100, y: 40, bulge: 0 },
          { x: 280, y: 40, bulge: 0 },
          { x: 280, y: 60, bulge: 0 },
          { x: 100, y: 60, bulge: 0 },
        ],
      ]
    : [];
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const codes = (p: Project, m = machine) => validateProject(p, { machine: m }).map((i) => i.code);
const tpCodes = (p: Project, m = machine) => buildToolpath(p, m).errors.map((e) => e.code);

function exportOf(p: Project, m = machine) {
  return exportNc(p, { profile: m, version: 1, verification: 'draft' }, postConfig('generic'));
}

/** Per tool change block: the tool number and every S word until the next change. */
function sByTool(nc: string): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  let tool = 0;
  for (const line of nc.split(/\r?\n/)) {
    const t = /^T(\d+)\s*M0?6/.exec(line);
    if (t) tool = Number(t[1]);
    const s = /(?:^|\s)S(\d+(?:\.\d+)?)/.exec(line.replace(/\(.*\)/, ''));
    if (s) {
      const set = out.get(tool) ?? new Set<number>();
      set.add(Number(s[1]));
      out.set(tool, set);
    }
  }
  return out;
}

describe('T307 range edges and machine switch (tester)', () => {
  it('min and max rpm are accepted, one step outside is refused', () => {
    const p = project();
    for (const rpm of [minRpm, maxRpm]) {
      expect(applyCommand(p, 'setSpindleRpm', { tool: 2, rpm }, { machine }).ok, `${rpm}`).toBe(
        true,
      );
    }
    for (const rpm of [minRpm - 1, maxRpm + 1]) {
      expect(applyCommand(p, 'setSpindleRpm', { tool: 2, rpm }, { machine }).ok, `${rpm}`).toBe(
        false,
      );
    }
  });

  it('an override valid on one machine is refused on a slower one, and never exported', () => {
    const r = applyCommand(project(), 'setSpindleRpm', { tool: 2, rpm: maxRpm }, { machine });
    if (!r.ok) throw new Error('set failed');
    const slow = machineWithTools();
    slow.spindle = { ...slow.spindle, maxRpm: 18000 };
    expect(codes(r.project, slow)).toContain('SPINDLE_RPM_OUT_OF_RANGE');
    expect(tpCodes(r.project, slow)).toContain('SPINDLE_RPM_OUT_OF_RANGE');
    expect(exportOf(r.project, slow).ok).toBe(false);
  });

  it('an out-of-range value for a tool the job does not use blocks nothing', () => {
    const p = clone(project()) as Project;
    p.cutting.spindleRpm = { '6': 99000 };
    expect(codes(p)).not.toContain('SPINDLE_RPM_OUT_OF_RANGE');
    expect(tpCodes(p)).toEqual([]);
  });
});

describe('T308 hand-edited and stale choices (tester)', () => {
  it('a pocket tool too short for the pocket depth is refused by command, validation and toolpath', () => {
    const deep = clone(project()) as Project;
    const pocket = deep.parts[0]?.holes[1];
    if (!pocket || pocket.type !== 'pocket') throw new Error('no pocket');
    pocket.depth = 14;
    expect(applyCommand(deep, 'setOperationTool', { op: 'pocket', tool: 7 }, { machine }).ok).toBe(
      false,
    );
    deep.cutting.tools = { pocket: 7 };
    expect(codes(deep)).toContain('OPERATION_TOOL_UNSUITABLE');
    expect(buildToolpath(deep, machine).ok).toBe(false);
    expect(exportOf(deep).ok).toBe(false);
  });

  it('a through-hole end mill too short for the sheet is refused by validation and toolpath', () => {
    const p = clone(project()) as Project;
    p.cutting.tools = { hole: 7 };
    expect(codes(p)).toContain('OPERATION_TOOL_UNSUITABLE');
    expect(buildToolpath(p, machine).ok).toBe(false);
  });

  it('a stale inner choice on a job without inner cuts: validation and toolpath agree', () => {
    const results: string[] = [];
    for (const [op, tool] of [
      ['inner', 7],
      ['inner', 42],
      ['inner', 3],
      ['pocket', 3],
      ['hole', 42],
    ] as const) {
      const p = clone(project(false)) as Project;
      const part = p.parts[0];
      if (!part) throw new Error('no part');
      if (op === 'pocket') part.holes = part.holes.filter((h) => h.type !== 'pocket');
      if (op === 'hole') part.holes = part.holes.filter((h) => h.type !== 'through');
      p.cutting.tools = { [op]: tool };
      // The job has no such operation, so there is no picker row to clear the choice from.
      expect(operationToolsOf(p, machine).map((r) => r.op)).not.toContain(op);
      const v = codes(p).filter((c) => c !== 'CUTTING_PARAMS_UNVERIFIED');
      const t = tpCodes(p);
      results.push(`${op} T${tool}: validation [${v.join()}] toolpath [${t.join()}]`);
    }
    // A choice for an operation the job does not have is never cut: it must block nothing.
    expect(results).toEqual(results.map((r) => r.replace(/toolpath \[[^\]]*\]/, 'toolpath []')));
  });
});

describe('T307 + T308 property (tester)', () => {
  it('any offered tool per operation + any in-range rpm: checked program, S inside the range', () => {
    const base = project();
    const rows = operationToolsOf(base, machine);
    const choice = fc.record(
      Object.fromEntries(
        rows.map((r) => [
          r.op,
          fc.option(fc.constantFrom(...r.candidates.map((t) => t.number)), { nil: undefined }),
        ]),
      ) as Record<string, fc.Arbitrary<number | undefined>>,
    );
    const rpm = fc.option(
      fc.integer({ min: minRpm / 100, max: maxRpm / 100 }).map((n) => n * 100),
      { nil: undefined },
    );
    fc.assert(
      fc.property(choice, fc.array(rpm, { minLength: 8, maxLength: 8 }), (ops, rpms) => {
        let p = base;
        for (const [op, tool] of Object.entries(ops)) {
          if (tool === undefined) continue;
          const r = applyCommand(p, 'setOperationTool', { op, tool }, { machine });
          if (!r.ok) return; // a chosen outer tool may make another choice unsuitable: skip
          p = r.project;
        }
        const own = new Map<number, number>();
        rpms.forEach((v, i) => {
          if (v === undefined) return;
          const r = applyCommand(p, 'setSpindleRpm', { tool: i + 1, rpm: v }, { machine });
          if (r.ok) {
            p = r.project;
            own.set(i + 1, v);
          }
        });
        // T330 (D-121): a low rpm raises the chip load; > 2 × the set's is a warning, not an error.
        expect(
          codes(p).filter(
            (c) => c !== 'CUTTING_PARAMS_UNVERIFIED' && c !== 'FEED_ABOVE_RECOMMENDED',
          ),
        ).toEqual([]);
        const r = exportOf(p);
        expect(r.ok, JSON.stringify(r.ok ? [] : r).slice(0, 400)).toBe(true);
        if (!r.ok) return;
        for (const f of r.files) {
          for (const [tool, ss] of sByTool(f.content)) {
            for (const s of ss) {
              expect(s).toBeGreaterThanOrEqual(minRpm);
              expect(s).toBeLessThanOrEqual(maxRpm);
              const want = own.get(tool);
              if (want !== undefined) expect(s, `T${tool}`).toBe(want);
            }
          }
          const used = [...sByTool(f.content).keys()].some((n) => own.has(n));
          if (used) expect(f.content).toMatch(/\(DEV.R T\d+: \d+ d\/dk elle/);
        }
      }),
      { numRuns: 40 },
    );
  });
});
