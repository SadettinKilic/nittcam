import { describe, expect, it } from 'vitest';
import { parseCabinetMemory } from './cabinet-memory';

describe('cabinet dialog memory (T260)', () => {
  const ok = {
    shelves: 2,
    back: { mode: 'overlay', thickness: 6 },
    doors: 2,
    band: 0.8,
    doorGap: 2,
  };

  it('reads back what was stored', () => {
    expect(parseCabinetMemory(JSON.stringify(ok))).toEqual(ok);
  });

  it('ignores missing, broken or out-of-range values', () => {
    expect(parseCabinetMemory(null)).toBeNull();
    expect(parseCabinetMemory('{')).toBeNull();
    expect(parseCabinetMemory(JSON.stringify({ ...ok, doors: 3 }))).toBeNull();
    expect(parseCabinetMemory(JSON.stringify({ ...ok, shelves: -1 }))).toBeNull();
  });

  it('never carries the box size', () => {
    const r = parseCabinetMemory(JSON.stringify({ ...ok, width: 900 }));
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('width');
  });
});
