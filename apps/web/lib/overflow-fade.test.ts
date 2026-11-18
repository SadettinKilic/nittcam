import { describe, expect, it } from 'vitest';
import { fadeMask, overflowEdges } from './overflow-fade';

describe('plate tab strip (T199b)', () => {
  it('reports the clipped edges', () => {
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({
      start: false,
      end: false,
    });
    expect(overflowEdges({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 })).toEqual({
      start: false,
      end: true,
    });
    expect(overflowEdges({ scrollLeft: 200, scrollWidth: 500, clientWidth: 300 })).toEqual({
      start: true,
      end: false,
    });
  });

  it('fades only the clipped edges', () => {
    expect(fadeMask({ start: false, end: false })).toBeUndefined();
    expect(fadeMask({ start: false, end: true })).toMatch(
      /^linear-gradient\(to right, black 0, .*transparent 100%\)$/,
    );
    expect(fadeMask({ start: true, end: false })).toMatch(/transparent 0.*black 100%/);
  });
});
