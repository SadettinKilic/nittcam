/**
 * Tester checks for the board edit commands (T125, D-037):
 * - board positions (`draw`) never reach nesting input or the exported G-code;
 * - move / mirror / rotate / paste / remove are one undo step each and redo restores them;
 * - mirror and rotate compose like the plane symmetries they are (outline orientation rules
 *   hold: outer CCW, inners CW);
 * - bad parameters are refused without touching the project.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { localBox } from '../editor/board';
import { exportNc } from '../export/export';
import { golden, postConfig } from '../gcode-check/check.testing';
import { contour, orientation } from '../geometry/polyline';
import { nestingInputFromProject } from '../nesting/nest';
import { deriveOutline, parseProject, type Part, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';
import { COMMANDS } from './registry';

const ctx: CommandContext = { actor: 'user', at: '2026-11-18T10:00:00Z' };

function load(json: unknown): Project {
  const r = parseProject(JSON.parse(JSON.stringify(json)));
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

/** Part geometry without its board position, rounded against float noise. */
function shape(p: Part) {
  const r = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  return JSON.stringify({
    outline: deriveOutline(p).map((v) => [r(v.x), r(v.y), r(v.bulge)]),
    inners: p.inners.map((c) => c.map((v) => [r(v.x), r(v.y), r(v.bulge)])),
    holes: p.holes.map((h) => [h.id, r(h.cx), r(h.cy)]),
    band: p.edgeBand,
  });
}

const stripDraw = (p: Project): Project => ({
  ...p,
  parts: p.parts.map((part) => {
    const copy = { ...part };
    delete copy.draw;
    return copy;
  }),
});

describe('board commands, tester checks (T125, D-037)', () => {
  it('D-037: board moves never change the nesting input', () => {
    const p0 = load(mixed);
    const opts = { toolDiameter: 8 };
    const base = nestingInputFromProject(p0, opts);
    fc.assert(
      fc.property(
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -5000, max: 5000 }),
        fc.subarray(
          p0.parts.map((p) => p.id),
          { minLength: 1 },
        ),
        (dx, dy, ids) => {
          const p1 = run(p0, 'movePart', { ids, dx, dy });
          expect(p1.parts.every((p) => p.draw !== undefined)).toBe(true);
          expect(nestingInputFromProject(p1, opts)).toEqual(base);
        },
      ),
      { numRuns: 40 },
    );
  });

  it.each(['generic', 'mach3'] as const)(
    'D-037 (%s): exported G-code is byte-identical after board moves',
    (post) => {
      const g = golden(post, 'mixed');
      const ids = g.project.parts.map((p) => p.id);
      let moved = run(g.project, 'movePart', { ids, dx: 1234.5, dy: -987 });
      const first = ids[0];
      if (first) moved = run(moved, 'movePart', { ids: [first], dx: -17, dy: 3 });
      expect(moved.parts.every((p) => p.draw !== undefined)).toBe(true);
      const pv = { profile: g.context.profile, version: 1, verification: 'draft' as const };
      const meta = { projectName: 'Karışık (dikdörtgen alt küme)', revision: 1, fileStem: 'mixed' };
      const a = exportNc(g.project, pv, postConfig(post), meta);
      const b = exportNc(moved, pv, postConfig(post), meta);
      expect(b.ok).toBe(true);
      expect(b.files.map((f) => f.content)).toEqual(a.files.map((f) => f.content));
      expect(b.files[0]?.content).toBe(g.text);
      // And the same project with the board positions stripped is the same project.
      expect(stripDraw(moved).parts.map(shape)).toEqual(g.project.parts.map(shape));
    },
  );

  it('every board edit is one undo step; redo re-applies it exactly', () => {
    const p0 = load(shelfSet);
    const a = p0.parts[0]?.id ?? '';
    const b = p0.parts[1]?.id ?? '';
    const src = p0.parts[0];
    if (!src) throw new Error('fixture');
    const steps: [string, unknown][] = [
      ['movePart', { ids: [a, b], dx: 12.5, dy: -3 }],
      ['mirrorPart', { ids: [a], axis: 'h' }],
      ['rotatePart', { ids: [b], turns: 90 }],
      ['pasteParts', { parts: [{ ...src, id: 'tester-copy', draw: { x: 9000, y: 0 } }] }],
      ['removeParts', { ids: [a] }],
    ];
    const stack = new CommandStack(p0);
    const states = [JSON.stringify(stack.project)];
    for (const [name, params] of steps) {
      expect(stack.execute(name, params, ctx).ok).toBe(true);
      states.push(JSON.stringify(stack.project));
    }
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      expect(stack.undo()).toBe(true);
      expect(JSON.stringify(stack.project)).toBe(states[i]);
    }
    expect(stack.canUndo).toBe(false);
    for (let i = 1; i <= steps.length; i += 1) {
      expect(stack.redo()).toBe(true);
      expect(JSON.stringify(stack.project)).toBe(states[i]);
    }
  });

  it('mirror h then v equals a half turn; rotate 90 then 270 is the identity', () => {
    for (const fx of [mixed, shelfSet]) {
      const p0 = load(fx);
      const ids = p0.parts.map((p) => p.id);
      const hv = run(run(p0, 'mirrorPart', { ids, axis: 'h' }), 'mirrorPart', { ids, axis: 'v' });
      const half = run(p0, 'rotatePart', { ids, turns: 180 });
      expect(hv.parts.map(shape)).toEqual(half.parts.map(shape));
      const back = run(run(p0, 'rotatePart', { ids, turns: 90 }), 'rotatePart', {
        ids,
        turns: 270,
      });
      expect(back.parts.map(shape)).toEqual(p0.parts.map(shape));
      expect(back.parts.map((p) => p.draw)).toEqual(
        run(p0, 'movePart', { ids, dx: 0, dy: 0 }).parts.map((p) => p.draw),
      );
    }
  });

  it('after any mix of mirrors and rotations: outer CCW, inners CW, holes inside the box', () => {
    const p0 = load(mixed);
    const ids = p0.parts.map((p) => p.id);
    const op = fc.oneof(
      fc.constantFrom('h', 'v').map((axis) => ['mirrorPart', { ids, axis }] as const),
      fc.constantFrom(90, 180, 270).map((turns) => ['rotatePart', { ids, turns }] as const),
    );
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 5 }), (ops) => {
        let p = p0;
        for (const [name, params] of ops) p = run(p, name, params);
        for (const part of p.parts) {
          expect(orientation(contour(deriveOutline(part)))).toBe('ccw');
          for (const inner of part.inners) expect(orientation(contour(inner))).toBe('cw');
          // Arc-aware local box (an arch bulges past its vertices).
          const b = localBox(part);
          for (const h of part.holes) {
            expect(h.cx).toBeGreaterThanOrEqual(b.minX - 1e-6);
            expect(h.cx).toBeLessThanOrEqual(b.maxX + 1e-6);
            expect(h.cy).toBeGreaterThanOrEqual(b.minY - 1e-6);
            expect(h.cy).toBeLessThanOrEqual(b.maxY + 1e-6);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it('a duplicated id in one move moves the part once', () => {
    const p0 = load(shelfSet);
    const id = p0.parts[0]?.id ?? '';
    const once = run(p0, 'movePart', { ids: [id], dx: 10, dy: 0 });
    const twice = run(p0, 'movePart', { ids: [id, id], dx: 10, dy: 0 });
    expect(twice.parts[0]?.draw).toEqual(once.parts[0]?.draw);
  });

  it('refuses bad parameters and leaves the project unchanged', () => {
    const p0 = load(shelfSet);
    const id = p0.parts[0]?.id ?? '';
    const bad: [string, unknown][] = [
      ['movePart', { ids: [], dx: 1, dy: 1 }],
      ['movePart', { ids: [id], dx: Number.NaN, dy: 0 }],
      ['movePart', { ids: [id], dx: Number.POSITIVE_INFINITY, dy: 0 }],
      ['movePart', { ids: [id], dx: 1 }],
      ['movePart', { ids: [id], dx: 1, dy: 1, extra: true }],
      ['mirrorPart', { ids: [id], axis: 'x' }],
      ['rotatePart', { ids: [id], turns: 45 }],
      ['rotatePart', { ids: ['nope'], turns: 90 }],
      ['pasteParts', { parts: [] }],
      ['removeParts', { ids: ['nope'] }],
    ];
    const before = JSON.stringify(p0);
    for (const [name, params] of bad) {
      const r = applyCommand(p0, name, params);
      expect(r.ok, `${name} ${JSON.stringify(params)}`).toBe(false);
    }
    expect(JSON.stringify(p0)).toBe(before);
  });

  it('board edit commands are not AI tools', () => {
    for (const n of [
      'movePart',
      'mirrorPart',
      'rotatePart',
      'pasteParts',
      'removeParts',
    ] as const) {
      expect(COMMANDS[n].aiTool).toBe(false);
    }
  });
});
