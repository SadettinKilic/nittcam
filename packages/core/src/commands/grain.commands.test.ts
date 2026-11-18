/** T112 grain commands (D-034, D-038): setGrain, setPartGrain, grainLock alias, board turns. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { normalizeGrain } from '../geometry/grain';
import { parseProject, type Part, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-18T10:00:00Z' };

function load(json: unknown = cabinetDoors): Project {
  const r = parseProject(JSON.parse(JSON.stringify(json)));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

function part(p: Project, id: string): Part {
  const found = p.parts.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

/** Grain angles with up to 3 decimals in [0, 180). */
const angle = fc.integer({ min: 0, max: 179_999 }).map((n) => n / 1000);
const mode = fc.constantFrom('free' as const, 'fixed' as const);

describe('setPartGrain', () => {
  it('sets mode and angle of one part only', () => {
    const start = load();
    const id = start.parts[0]?.id ?? '';
    const next = run(start, 'setPartGrain', { id, mode: 'fixed', angle: 30 });
    expect(part(next, id).grain).toEqual({ mode: 'fixed', angle: 30 });
    expect(next.parts.slice(1)).toEqual(start.parts.slice(1));
    expect(next.stock).toBe(start.stock);
  });

  it('rejects unknown parts and angles outside [0, 180)', () => {
    const start = load();
    const id = start.parts[0]?.id ?? '';
    for (const params of [
      { id: 'nope', mode: 'free', angle: 0 },
      { id, mode: 'fixed', angle: 180 },
      { id, mode: 'fixed', angle: -0.5 },
      { id, mode: 'locked', angle: 0 },
    ]) {
      expect(applyCommand(start, 'setPartGrain', params).ok).toBe(false);
    }
  });

  it('apply then undo restores the project byte for byte; redo re-applies', () => {
    fc.assert(
      fc.property(mode, angle, fc.constantFrom(cabinetDoors, mixed, shelfSet), (m, a, json) => {
        const start = load(json);
        const id = start.parts[0]?.id ?? '';
        const stack = new CommandStack(start);
        const before = JSON.stringify(stack.project);
        const res = stack.execute('setPartGrain', { id, mode: m, angle: a }, ctx);
        expect(res.ok).toBe(true);
        const after = JSON.stringify(stack.project);
        stack.undo();
        expect(JSON.stringify(stack.project)).toBe(before);
        stack.redo();
        expect(JSON.stringify(stack.project)).toBe(after);
      }),
      { numRuns: 60 },
    );
  });
});

describe('grainLock alias (one release)', () => {
  it('addPart grainLock: true = fixed along the sheet grain; an explicit grain wins', () => {
    const shelves = load(shelfSet); // sheet grain 90
    const locked = run(shelves, 'addPart', {
      id: 'x',
      grainLock: true,
      params: { w: 10, h: 20, r: 0 },
    });
    expect(part(locked, 'x').grain).toEqual({ mode: 'fixed', angle: 90 });
    const explicit = run(shelves, 'addPart', {
      id: 'y',
      grain: { mode: 'fixed', angle: 12.5 },
      params: { w: 10, h: 20, r: 0 },
    });
    expect(part(explicit, 'y').grain).toEqual({ mode: 'fixed', angle: 12.5 });
    const plain = run(shelves, 'addPart', { id: 'z', params: { w: 10, h: 20, r: 0 } });
    expect(part(plain, 'z').grain).toEqual({ mode: 'free', angle: 0 });
  });

  it('updatePart accepts grainLock and grain', () => {
    const start = load();
    const id = start.parts[0]?.id ?? '';
    const free = run(start, 'updatePart', { id, grainLock: false });
    expect(part(free, id).grain).toEqual({ mode: 'free', angle: 0 });
    const fixed = run(free, 'updatePart', { id, grainLock: true });
    expect(part(fixed, id).grain).toEqual({ mode: 'fixed', angle: start.stock.sheet.grain });
    const angled = run(free, 'updatePart', { id, grain: { mode: 'fixed', angle: 45 } });
    expect(part(angled, id).grain).toEqual({ mode: 'fixed', angle: 45 });
  });

  it('a sheet without grain gives a locked part angle 0', () => {
    const start = run(load(), 'setGrain', { grain: null });
    const next = run(start, 'addPart', { id: 'n', grainLock: true, params: { w: 1, h: 1, r: 0 } });
    expect(part(next, 'n').grain).toEqual({ mode: 'fixed', angle: 0 });
  });
});

describe('grain follows the piece on the board (D-038)', () => {
  const withGrain = (p: Project, id: string, a: number): Project =>
    run(p, 'setPartGrain', { id, mode: 'fixed', angle: a });

  it('a quarter turn adds 90° (mod 180); 180° keeps the grain', () => {
    const start = load(mixed);
    const id = start.parts[0]?.id ?? '';
    const p = withGrain(start, id, 30);
    expect(part(run(p, 'rotatePart', { ids: [id], turns: 90 }), id).grain.angle).toBe(120);
    expect(part(run(p, 'rotatePart', { ids: [id], turns: 180 }), id).grain.angle).toBe(30);
    expect(part(run(p, 'rotatePart', { ids: [id], turns: 270 }), id).grain.angle).toBe(120);
    expect(part(run(p, 'mirrorPart', { ids: [id], axis: 'h' }), id).grain.angle).toBe(150);
    expect(part(run(p, 'mirrorPart', { ids: [id], axis: 'v' }), id).grain.angle).toBe(150);
  });

  it('property: 4 × rotate 90° and mirror twice are the identity, grain included', () => {
    fc.assert(
      fc.property(angle, fc.constantFrom(cabinetDoors, mixed, shelfSet), (a, json) => {
        const start = load(json);
        for (const { id } of start.parts) {
          const p0 = withGrain(start, id, a);
          let p = p0;
          for (let i = 0; i < 4; i += 1) p = run(p, 'rotatePart', { ids: [id], turns: 90 });
          expect(part(p, id).grain).toEqual(part(p0, id).grain);
          for (const axis of ['h', 'v'] as const) {
            const twice = run(run(p0, 'mirrorPart', { ids: [id], axis }), 'mirrorPart', {
              ids: [id],
              axis,
            });
            expect(part(twice, id).grain).toEqual(part(p0, id).grain);
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it('property: the grain relative to the shape is kept by every turn and mirror', () => {
    // Model: the grain of a turned/mirrored piece equals the same transform applied to the line.
    fc.assert(
      fc.property(
        angle,
        fc.array(fc.constantFrom('r90', 'r180', 'r270', 'mh', 'mv'), { maxLength: 8 }),
        (a, ops) => {
          const start = load(mixed);
          const id = start.parts[0]?.id ?? '';
          let p = withGrain(start, id, a);
          let expected = a;
          for (const op of ops) {
            if (op.startsWith('r')) {
              const turns = Number(op.slice(1));
              p = run(p, 'rotatePart', { ids: [id], turns });
              expected = normalizeGrain(expected + turns);
            } else {
              p = run(p, 'mirrorPart', { ids: [id], axis: op === 'mh' ? 'h' : 'v' });
              expected = normalizeGrain(-expected);
            }
          }
          expect(part(p, id).grain.angle).toBeCloseTo(expected, 9);
          expect(part(p, id).grain.mode).toBe('fixed');
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('setPartsGrain (T116)', () => {
  it('sets the same grain on every listed part in one undo step', () => {
    const start = load(mixed);
    const ids = start.parts.map((p) => p.id);
    const stack = new CommandStack(start);
    const before = JSON.stringify(stack.project);
    expect(stack.execute('setPartsGrain', { ids, mode: 'fixed', angle: 30 }, ctx).ok).toBe(true);
    for (const p of stack.project.parts) expect(p.grain).toEqual({ mode: 'fixed', angle: 30 });
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(before);
  });

  it('leaves other parts alone and rejects unknown ids', () => {
    const start = load(mixed);
    const [first, ...rest] = start.parts;
    const next = run(start, 'setPartsGrain', { ids: [first?.id], mode: 'fixed', angle: 90 });
    expect(next.parts.slice(1)).toEqual(rest);
    expect(applyCommand(start, 'setPartsGrain', { ids: ['nope'], mode: 'free', angle: 0 }).ok).toBe(
      false,
    );
  });
});
