/**
 * Property tests (spec §5.1, command-layer skill): for random command sequences, undoing every
 * command restores the start project exactly, and redoing them all returns the same end state.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { CommandStack, type CommandContext } from './index';

const mm = fc.double({ min: 0.1, max: 4000, noNaN: true, noDefaultInfinity: true });

const commandArb = fc.oneof(
  fc.record({
    name: fc.constant('setMachine'),
    params: fc.record({
      machineId: fc.string({ minLength: 1, maxLength: 12 }),
      profileVersion: fc.integer({ min: 1, max: 50 }),
    }),
  }),
  fc.record({
    name: fc.constant('setMaterial'),
    params: fc.record({ material: fc.constantFrom('mdf', 'plywood', 'chipboard', 'hdf') }),
  }),
  fc.record({
    name: fc.constant('setThickness'),
    params: fc.record({ thickness: fc.double({ min: 1, max: 60, noNaN: true }) }),
  }),
  fc.record({
    name: fc.constant('setSheetSize'),
    params: fc.record({ width: mm, height: mm }),
  }),
  fc.record({
    name: fc.constant('addPart'),
    params: fc
      .record({
        // A small id pool so duplicates (rejected commands) also occur.
        id: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'door-left'),
        name: fc.string({ maxLength: 8 }),
        qty: fc.integer({ min: 1, max: 20 }),
        grainLock: fc.boolean(),
        w: mm,
        h: mm,
        rFactor: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map(({ w, h, rFactor, ...rest }) => ({
        ...rest,
        params: { w, h, r: (Math.min(w, h) / 2) * rFactor },
      })),
  }),
);

const contextArb: fc.Arbitrary<CommandContext> = fc.record({
  actor: fc.constantFrom('user' as const, 'ai' as const),
  at: fc.constantFrom('2026-11-16T10:00:00Z', '2026-11-16T10:00:00.123+03:00'),
});

function load(json: unknown): Project {
  const result = parseProject(JSON.parse(JSON.stringify(json)));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

const startArb = fc.constantFrom(cabinetDoors, shelfSet, mixed).map(load);

describe('undo/redo property', () => {
  it('undo all restores the start exactly; redo all returns the same end state', () => {
    fc.assert(
      fc.property(
        startArb,
        fc.array(fc.tuple(commandArb, contextArb), { maxLength: 25 }),
        (start, steps) => {
          const startJson = JSON.stringify(start);
          const stack = new CommandStack(start);
          let executed = 0;
          for (const [cmd, ctx] of steps) {
            if (stack.execute(cmd.name, cmd.params, ctx).ok) executed += 1;
          }
          const end = stack.project;
          const endJson = JSON.stringify(end);
          const endIssues = stack.issues;
          expect(stack.log).toHaveLength(executed);

          for (let i = 0; i < executed; i += 1) expect(stack.undo()).toBe(true);
          expect(stack.canUndo).toBe(false);
          expect(stack.project).toEqual(start);
          expect(JSON.stringify(stack.project)).toBe(startJson);

          for (let i = 0; i < executed; i += 1) expect(stack.redo()).toBe(true);
          expect(stack.canRedo).toBe(false);
          expect(stack.project).toEqual(end);
          expect(JSON.stringify(stack.project)).toBe(endJson);
          expect(stack.issues).toEqual(endIssues);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('every state reached by commands passes the project schema', () => {
    fc.assert(
      fc.property(startArb, fc.array(commandArb, { maxLength: 15 }), (start, cmds) => {
        const stack = new CommandStack(start);
        for (const cmd of cmds) {
          stack.execute(cmd.name, cmd.params, { actor: 'user', at: '2026-11-16T10:00:00Z' });
          expect(parseProject(JSON.parse(JSON.stringify(stack.project))).ok).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
