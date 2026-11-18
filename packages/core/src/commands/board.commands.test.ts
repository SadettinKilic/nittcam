import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { boardParts, boardPositions } from '../editor/board';
import { bbox, contour, orientation } from '../geometry/polyline';
import { deriveOutline, parseProject, type Part, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

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

function part(p: Project, id: string): Part {
  const found = p.parts.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

/** Geometry of a part without its board position, rounded against float noise. */
function shape(p: Part) {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return JSON.stringify({
    outline: deriveOutline(p).map((v) => [r(v.x), r(v.y), r(v.bulge)]),
    inners: p.inners.map((c) => c.map((v) => [r(v.x), r(v.y), r(v.bulge)])),
    holes: p.holes.map((h) => [h.id, r(h.cx), r(h.cy)]),
    band: p.edgeBand,
  });
}

describe('board commands (T125)', () => {
  it('movePart moves only the given parts and freezes the others where they were', () => {
    const p0 = load(shelfSet);
    const before = boardPositions(p0);
    const [a, b] = p0.parts;
    if (!a || !b) throw new Error('fixture');
    const p1 = run(p0, 'movePart', { ids: [a.id], dx: 10, dy: -20 });
    const after = boardPositions(p1);
    expect(after.get(a.id)).toEqual({
      x: (before.get(a.id)?.x ?? 0) + 10,
      y: (before.get(a.id)?.y ?? 0) - 20,
    });
    expect(after.get(b.id)).toEqual(before.get(b.id));
    expect(p1.parts.every((p) => p.draw !== undefined)).toBe(true);
  });

  it('rejects unknown ids', () => {
    const r = applyCommand(load(shelfSet), 'movePart', { ids: ['nope'], dx: 1, dy: 1 });
    expect(r.ok).toBe(false);
  });

  it('mirror: twice is the identity; outer stays CCW, inners CW; bands swap', () => {
    const p0 = load(mixed);
    for (const id of p0.parts.map((p) => p.id)) {
      for (const axis of ['h', 'v'] as const) {
        const once = run(p0, 'mirrorPart', { ids: [id], axis });
        const m = part(once, id);
        expect(orientation(contour(deriveOutline(m)))).toBe('ccw');
        for (const c of m.inners) expect(orientation(contour(c))).toBe('cw');
        const o = part(p0, id).edgeBand;
        if (axis === 'h') expect([m.edgeBand.left, m.edgeBand.right]).toEqual([o.right, o.left]);
        else expect([m.edgeBand.top, m.edgeBand.bottom]).toEqual([o.bottom, o.top]);
        const twice = run(once, 'mirrorPart', { ids: [id], axis });
        expect(shape(part(twice, id))).toBe(shape(part(p0, id)));
      }
    }
  });

  it('mirror h maps a hole to the other side of the part', () => {
    const p0 = load(mixed);
    const tray = part(p0, 'tray');
    const hole = tray.holes[0];
    if (!hole || tray.kind !== 'rect') throw new Error('fixture');
    const m = part(run(p0, 'mirrorPart', { ids: ['tray'], axis: 'h' }), 'tray');
    expect(m.holes[0]?.cx).toBeCloseTo(tray.params.w - hole.cx);
    expect(m.holes[0]?.cy).toBeCloseTo(hole.cy);
  });

  it('rotate: four quarter turns are the identity; 90° swaps w/h and keeps the centre', () => {
    const p0 = load(mixed);
    for (const id of p0.parts.map((p) => p.id)) {
      let p = p0;
      for (let i = 0; i < 4; i += 1) p = run(p, 'rotatePart', { ids: [id], turns: 90 });
      expect(shape(part(p, id))).toBe(shape(part(p0, id)));
    }
    const tray = part(p0, 'tray');
    if (tray.kind !== 'rect') throw new Error('fixture');
    const centre = (p: Project) => {
      const bp = boardParts(p).find((x) => x.id === 'tray');
      if (!bp) throw new Error('tray');
      return { x: (bp.box.minX + bp.box.maxX) / 2, y: (bp.box.minY + bp.box.maxY) / 2 };
    };
    const r = run(p0, 'rotatePart', { ids: ['tray'] });
    const t = part(r, 'tray');
    if (t.kind !== 'rect') throw new Error('kind');
    expect([t.params.w, t.params.h]).toEqual([tray.params.h, tray.params.w]);
    expect(t.edgeBand.top).toBe(tray.edgeBand.right);
    expect(centre(r).x).toBeCloseTo(centre(p0).x);
    expect(centre(r).y).toBeCloseTo(centre(p0).y);
  });

  it('rotate keeps holes inside the part (property)', () => {
    const p0 = load(mixed);
    fc.assert(
      fc.property(
        fc.constantFrom(90, 180, 270),
        fc.constantFrom('tray', 'arch-panel'),
        (turns, id) => {
          const p = part(run(p0, 'rotatePart', { ids: [id], turns }), id);
          const b = bbox(contour(deriveOutline(p)));
          for (const h of p.holes) {
            expect(h.cx).toBeGreaterThanOrEqual(b.minX - 1e-6);
            expect(h.cx).toBeLessThanOrEqual(b.maxX + 1e-6);
            expect(h.cy).toBeGreaterThanOrEqual(b.minY - 1e-6);
            expect(h.cy).toBeLessThanOrEqual(b.maxY + 1e-6);
          }
        },
      ),
    );
  });

  it('pasteParts adds copies in one step; taken ids are refused; undo removes them', () => {
    const p0 = load(shelfSet);
    const src = p0.parts[0];
    if (!src) throw new Error('fixture');
    const copy = { ...src, id: 'copy-1', draw: { x: 5000, y: 0 } };
    const stack = new CommandStack(p0);
    expect(stack.execute('pasteParts', { parts: [copy] }, ctx).ok).toBe(true);
    expect(part(stack.project, 'copy-1').draw).toEqual({ x: 5000, y: 0 });
    expect(stack.execute('pasteParts', { parts: [copy] }, ctx).ok).toBe(false);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
  });

  it('removeParts removes several parts and their placements in one step', () => {
    const p0 = load(mixed);
    const ids = p0.parts.map((p) => p.id);
    const p1 = run(p0, 'removeParts', { ids });
    expect(p1.parts).toEqual([]);
    expect(p1.layout.sheets.every((s) => s.placements.length === 0)).toBe(true);
  });
});
