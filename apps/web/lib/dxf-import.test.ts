import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  baseName,
  checkDxfFile,
  effectiveMap,
  importParams,
  layerCounts,
  loadDxf,
  MAX_DXF_BYTES,
  summarize,
  svgPath,
  viewBox,
} from './dxf-import';
import { planDxfImport } from '@nittcam/core';

const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '..', '..', '..', 'packages', 'core', 'src', 'dxf', '__fixtures__', name),
    'utf8',
  );

describe('checkDxfFile (T146)', () => {
  it('refuses DWG by name or by content, other types, size and empty files', () => {
    expect(checkDxfFile('plan.DWG', 100, '')).toBe('dwg');
    expect(checkDxfFile('plan.dxf', 100, 'AC1032\u0000')).toBe('dwg');
    expect(checkDxfFile('plan.svg', 100, '<svg')).toBe('type');
    expect(checkDxfFile('plan.dxf', MAX_DXF_BYTES + 1, '  0')).toBe('size');
    expect(checkDxfFile('plan.dxf', 0, '')).toBe('empty');
    expect(checkDxfFile('plan.dxf', 10, 'AutoCAD Binary DXF')).toBe('binary');
    expect(checkDxfFile('Tabela.dxf', 100, '  0\nSECTION')).toBeNull();
  });
});

describe('loadDxf + summarize', () => {
  it('sign-letters: 3 parts, O counter as inner, ignored hatch/text listed', () => {
    const r = loadDxf(fixture('sign-letters.dxf'));
    if (!r.ok) throw new Error(r.problem);
    const plan = planDxfImport(r.drawing);
    const s = summarize(r.drawing, plan);
    expect(s).toMatchObject({ parts: 3, inners: 1, supported: 9, ignored: 2, open: 0 });
    expect(s.ignoredTypes).toEqual([
      ['HATCH', 1],
      ['MTEXT', 1],
    ]);
    expect(layerCounts(r.drawing)).toEqual([{ layer: 'HARF', count: 9 }]);
  });

  it('maps parse errors to problems', () => {
    expect(loadDxf('junk')).toEqual({ ok: false, problem: 'parse' });
  });

  it('a chosen unit rescales (no-units-small in cm)', () => {
    const r = loadDxf(fixture('no-units-small.dxf'), 'cm');
    if (!r.ok) throw new Error(r.problem);
    expect(r.drawing.units.uncertain).toBeUndefined();
    expect(r.drawing.bbox).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 30 });
  });
});

describe('preview', () => {
  it('svgPath flips Y and keeps arcs (CCW bulge → sweep 0)', () => {
    expect(
      svgPath({
        closed: true,
        vertices: [
          { x: 10, y: 0, bulge: 1 },
          { x: -10, y: 0, bulge: 1 },
        ],
      }),
    ).toBe('M10 0A10 10 0 0 0 -10 0A10 10 0 0 0 10 0Z');
    expect(
      svgPath({
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 5, y: 5, bulge: 0 },
        ],
      }),
    ).toBe('M0 0L5 -5');
    expect(viewBox({ minX: 0, minY: 0, maxX: 100, maxY: 50 })).toBe('-3 -53 106 56');
  });
});

describe('importParams', () => {
  it('names parts after the file and applies the layer choice', () => {
    const r = loadDxf(fixture('rect-lines-gaps.dxf'));
    if (!r.ok) throw new Error(r.problem);
    let n = 0;
    const { parts, plan } = importParams(
      r.drawing,
      effectiveMap({}, {}),
      baseName('Panel A.dxf'),
      () => `p${++n}`,
    );
    expect(parts.map((p) => [p.id, p.name])).toEqual([['p1', 'Panel A']]);
    expect(plan.open).toHaveLength(1);
    const ignored = importParams(r.drawing, effectiveMap({}, { cut: 'ignore' }), 'x', () => 'id');
    expect(ignored.parts).toHaveLength(0);
  });

  it('effectiveMap: this import overrides the stored mapping (case-insensitive)', () => {
    expect(effectiveMap({ CUT: 'inside', A: 'drill' }, { cut: 'outside' })).toEqual({
      CUT: 'outside',
      A: 'drill',
    });
  });
});
