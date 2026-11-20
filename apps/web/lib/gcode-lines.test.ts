import { describe, expect, it } from 'vitest';
import { lineTarget, type Row } from './gcode-lines';

const rows: Row[] = [
  { kind: 'file', file: 0, name: 'a.nc' },
  { kind: 'line', file: 0, line: 1, text: 'G21' },
  { kind: 'line', file: 0, line: 2, text: 'G90' },
  { kind: 'file', file: 1, name: 'b.nc' },
  { kind: 'line', file: 1, line: 1, text: 'G21' },
];

describe('lineTarget (T185 G-code list keys)', () => {
  it('arrows move a line and skip file headers', () => {
    expect(lineTarget(rows, 1, 'ArrowDown')).toEqual({ file: 0, line: 2 });
    expect(lineTarget(rows, 2, 'ArrowDown')).toEqual({ file: 1, line: 1 });
    expect(lineTarget(rows, 4, 'ArrowUp')).toEqual({ file: 0, line: 2 });
  });

  it('nothing selected: down goes to the first line, up nowhere', () => {
    expect(lineTarget(rows, -1, 'ArrowDown')).toEqual({ file: 0, line: 1 });
    expect(lineTarget(rows, -1, 'ArrowUp')).toBeNull();
  });

  it('Home / End and the edges', () => {
    expect(lineTarget(rows, 2, 'Home')).toEqual({ file: 0, line: 1 });
    expect(lineTarget(rows, 1, 'End')).toEqual({ file: 1, line: 1 });
    expect(lineTarget(rows, 4, 'ArrowDown')).toBeNull();
    expect(lineTarget(rows, 1, 'ArrowUp')).toBeNull();
  });

  it('other keys are not list keys (Tab leaves the list)', () => {
    expect(lineTarget(rows, 1, 'Tab')).toBeUndefined();
    expect(lineTarget([], -1, 'End')).toBeNull();
  });
});
