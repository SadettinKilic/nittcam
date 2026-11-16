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
const band = fc.constantFrom(0, 0.4, 0.8, 2);
/** Ids of the fixtures' parts plus the pool addPart uses. */
const partIdArb = fc.constantFrom(
  'a',
  'b',
  'c',
  'door-left',
  'door-right',
  'side',
  'shelf',
  'arch-panel',
  'tray',
  'x1',
);

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
  // T011 part commands. Ids come from the same pool as the fixtures and addPart, so unknown or
  // taken ids (rejected commands) occur as well as valid ones.
  fc.record({
    name: fc.constant('updatePart'),
    params: fc.record(
      {
        id: partIdArb,
        name: fc.string({ maxLength: 8 }),
        qty: fc.integer({ min: 0, max: 6 }),
        grainLock: fc.boolean(),
        params: fc.record(
          { w: mm, h: mm, r: fc.double({ min: 0, max: 50, noNaN: true }) },
          { requiredKeys: [] },
        ),
        edgeBand: fc.record(
          { top: band, right: band, bottom: band, left: band },
          { requiredKeys: [] },
        ),
      },
      { requiredKeys: ['id'] },
    ),
  }),
  fc.record({ name: fc.constant('removePart'), params: fc.record({ id: partIdArb }) }),
  fc.record({
    name: fc.constant('duplicatePart'),
    params: fc.record(
      { id: partIdArb, newId: partIdArb, name: fc.string({ maxLength: 8 }) },
      {
        requiredKeys: ['id', 'newId'],
      },
    ),
  }),
  fc.record({
    name: fc.constant('importCutList'),
    params: fc.record({
      parts: fc.array(
        fc.record(
          {
            id: partIdArb,
            name: fc.string({ maxLength: 8 }),
            qty: fc.integer({ min: 1, max: 20 }),
            grainLock: fc.boolean(),
            params: fc.record({ w: mm, h: mm, r: fc.constant(0) }),
            edgeBand: fc.record({ top: band, right: band, bottom: band, left: band }),
          },
          { requiredKeys: ['id', 'params'] },
        ),
        { maxLength: 4 },
      ),
    }),
  }),
  // T012 nesting commands.
  fc.record({
    name: fc.constant('setNestingOptions'),
    params: fc.record(
      {
        mode: fc.constantFrom('minWaste', 'fastest', 'minToolChanges'),
        gap: fc.double({ min: 0, max: 30, noNaN: true }),
        margin: fc.double({ min: 0, max: 50, noNaN: true }),
      },
      { requiredKeys: [] },
    ),
  }),
  fc.record({
    name: fc.constant('runNesting'),
    params: fc.record({ toolDiameter: fc.constantFrom(0, 3, 6, 8, 60) }),
  }),
  // T013 manual placement.
  fc.record({
    name: fc.constant('lockPlacement'),
    params: fc.record(
      {
        partId: fc.constantFrom('door-left', 'door-right', 'arch-panel', 'tray', 'side', 'shelf'),
        index: fc.integer({ min: 0, max: 3 }),
        x: fc.integer({ min: -100, max: 3000 }),
        y: fc.integer({ min: -100, max: 2200 }),
        rot: fc.constantFrom(0, 90, 180, 270),
        locked: fc.boolean(),
      },
      { requiredKeys: ['partId', 'index'] },
    ),
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
            const r = stack.execute(cmd.name, cmd.params, ctx);
            // A no-op command (changed: false) leaves no history step.
            if (r.ok && r.changed) executed += 1;
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
