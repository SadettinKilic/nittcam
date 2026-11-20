import { describe, expect, it } from 'vitest';
import { layerRowErrors, layerRowsToMap, mapToLayerRows } from './dxf-layer-editor';

describe('DXF layer editor rows (T182)', () => {
  it('round-trips a stored map, sorted by name', () => {
    let n = 0;
    const rows = mapToLayerRows({ KESIM: 'outside', DELIK: 'drill' }, () => `r${(n += 1)}`);
    expect(rows.map((r) => r.name)).toEqual(['DELIK', 'KESIM']);
    expect(layerRowsToMap(rows)).toEqual({ DELIK: 'drill', KESIM: 'outside' });
  });

  it('marks empty names and case-insensitive duplicates', () => {
    const rows = [
      { id: 'a', name: 'Kesim', op: 'outside' as const },
      { id: 'b', name: ' KESIM ', op: 'inside' as const },
      { id: 'c', name: '  ', op: 'drill' as const },
      { id: 'd', name: 'Cep', op: 'pocket' as const },
    ];
    expect(layerRowErrors(rows)).toEqual({ a: 'duplicate', b: 'duplicate', c: 'empty' });
    expect(layerRowsToMap(rows)).toEqual({ KESIM: 'inside', CEP: 'pocket' });
  });

  it('drops auto rows (unlisted already means auto)', () => {
    expect(layerRowsToMap([{ id: 'a', name: 'x', op: 'auto' }])).toEqual({});
  });
});
