import { describe, expect, it } from 'vitest';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { BOARD_GAP, BOARD_ROW, boardBox, boardParts, boardPositions, localBox } from './board';

function load(raw: unknown): Project {
  const r = parseProject(raw);
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

function overlaps(a: { minX: number; minY: number; maxX: number; maxY: number }, b: typeof a) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

describe('drawing board (T124)', () => {
  it('auto-arranges parts in rows from the top, at the origin, without overlaps', () => {
    const p = load(shelfSet);
    const parts = boardParts(p);
    expect(parts).toHaveLength(p.parts.length);
    for (const [i, a] of parts.entries()) {
      expect(a.placed).toBe(false);
      expect(a.box.minY).toBeGreaterThanOrEqual(0);
      expect(a.box.minX).toBeGreaterThanOrEqual(0);
      expect(a.box.maxX).toBeLessThanOrEqual(Math.max(BOARD_ROW, a.box.maxX - a.box.minX));
      for (const b of parts.slice(i + 1)) expect(overlaps(a.box, b.box)).toBe(false);
    }
    const all = boardBox(parts);
    expect(parts[0]?.box.minX).toBe(0);
    expect(parts[0]?.box.maxY).toBe(all?.maxY);
    expect(all?.minY).toBe(0);
  });

  it('keeps a placed part at its draw position and arranges the rest below it', () => {
    const p = load(shelfSet);
    const first = p.parts[0];
    if (!first) throw new Error('no part');
    const moved: Project = {
      ...p,
      parts: p.parts.map((x, i) => (i === 0 ? { ...x, draw: { x: 500, y: 300 } } : x)),
    };
    const parts = boardParts(moved);
    expect(parts[0]?.at).toEqual({ x: 500, y: 300 });
    expect(parts[0]?.placed).toBe(true);
    const local = localBox(first);
    for (const b of parts.slice(1)) {
      expect(b.box.maxY).toBeLessThanOrEqual(300 + local.minY - BOARD_GAP + 1e-9);
    }
  });

  it('moves outline, inners and holes with the part', () => {
    const p = load(mixed);
    const pos = boardPositions(p);
    for (const [i, bp] of boardParts(p).entries()) {
      const part = p.parts[i];
      if (!part) throw new Error('missing');
      const at = pos.get(part.id);
      expect(bp.at).toEqual(at);
      part.holes.forEach((h, k) => {
        expect(bp.holes[k]?.x).toBeCloseTo(h.cx + (at?.x ?? 0));
        expect(bp.holes[k]?.y).toBeCloseTo(h.cy + (at?.y ?? 0));
      });
      part.inners.forEach((c, k) => {
        expect(bp.inners[k]?.[0]?.x).toBeCloseTo((c[0]?.x ?? 0) + (at?.x ?? 0));
      });
    }
  });

  it('boardBox spans all parts; empty board has none', () => {
    const parts = boardParts(load(shelfSet));
    const box = boardBox(parts);
    expect(box?.minX).toBe(0);
    expect(box?.minY).toBe(0);
    expect(boardBox([])).toBeUndefined();
  });
});
