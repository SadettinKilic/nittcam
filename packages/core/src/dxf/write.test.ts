import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EPS } from '../geometry/constants';
import { bbox, normalize } from '../geometry/polyline';
import type { Polyline } from '../geometry/types';
import { parseProject, type Project } from '../schema';
import { planDxfImport } from './plan';
import { readDxf } from './read';
import {
  DXF_EXPORT_GAP,
  DXF_EXPORT_LAYERS,
  DXF_EXPORT_LAYER_MAP,
  dxfNumber,
  layoutEntities,
  partsEntities,
  writeDxfEntities,
  writeProjectDxf,
  type DxfEntity,
} from './write';

const band = { top: 0, right: 0, bottom: 0, left: 0 };

/** Two parts with arcs, holes of every kind, an inner contour, an open line; two sheets. */
function sample(): Project {
  const r = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2440, height: 1220, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'door',
        name: 'Kapak',
        qty: 2,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: 600, h: 400, r: 20 },
        // A slot with two half-circle ends (bulge −1 = CW half circle).
        inners: [
          [
            { x: 200, y: 180, bulge: 0 },
            { x: 200, y: 220, bulge: -1 },
            { x: 400, y: 220, bulge: 0 },
            { x: 400, y: 180, bulge: -1 },
          ],
        ],
        holes: [
          { id: 'h1', type: 'through', d: 8, cx: 50, cy: 50, tool: 1 },
          { id: 'h2', type: 'pocket', d: 35, cx: 100, cy: 300, tool: 1, depth: 12 },
          { id: 'h3', type: 'groove', d: 60, cx: 500, cy: 300, tool: 1, depth: 3, grooveWidth: 6 },
        ],
        lines: [
          {
            vertices: [
              { x: 50, y: 100, bulge: 0.4 },
              { x: 150, y: 100, bulge: 0 },
              { x: 150, y: 150, bulge: 0 },
            ],
            op: { kind: 'online', depth: 1 },
          },
        ],
        edgeBand: band,
        templates: [],
      },
      {
        id: 'arch',
        name: 'Kemer',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'freeform',
        // A 300 × 150 rectangle with a half-circle top (bulge +1 = CCW half circle).
        outline: [
          { x: 0, y: 0, bulge: 0 },
          { x: 300, y: 0, bulge: 0 },
          { x: 300, y: 150, bulge: 1 },
          { x: 0, y: 150, bulge: 0 },
        ],
        inners: [],
        holes: [],
        edgeBand: band,
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 4, margin: 10 },
    layout: {
      sheets: [
        {
          placements: [
            { partId: 'door', index: 0, x: 10, y: 10, rot: 0, locked: false },
            { partId: 'arch', index: 0, x: 700, y: 10, rot: 90, locked: false },
          ],
        },
        {
          size: { width: 1200, height: 800 },
          placements: [{ partId: 'door', index: 1, x: 10, y: 10, rot: 180, locked: false }],
        },
      ],
    },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

/** Same closed/open polyline within EPS (vertices and bulges, same start and direction). */
function samePoly(a: Polyline, b: Polyline): boolean {
  if (a.closed !== b.closed || a.vertices.length !== b.vertices.length) return false;
  const n = a.vertices.length;
  return a.vertices.every((v, i) => {
    const w = b.vertices[i];
    if (!w) return false;
    const lastOpen = !a.closed && i === n - 1;
    return (
      Math.abs(v.x - w.x) <= EPS &&
      Math.abs(v.y - w.y) <= EPS &&
      (lastOpen || Math.abs(v.bulge - w.bulge) <= EPS)
    );
  });
}

/** Every written entity is read back by our importer on the same layer, within EPS. */
function expectRoundTrip(entities: readonly DxfEntity[]): void {
  const read = readDxf(writeDxfEntities(entities));
  if (!read.ok) throw new Error(JSON.stringify(read.error));
  const d = read.value;
  expect(d.units.unit).toBe('mm');
  expect(d.paths).toHaveLength(entities.length);
  const left = [...d.paths];
  for (const e of entities) {
    const i = left.findIndex((p) =>
      p.layer !== e.layer
        ? false
        : e.type === 'circle'
          ? p.circle !== undefined &&
            Math.abs(p.circle.cx - e.cx) <= EPS &&
            Math.abs(p.circle.cy - e.cy) <= EPS &&
            Math.abs(p.circle.d - 2 * e.r) <= EPS
          : samePoly(p.poly, e.poly),
    );
    expect(i, `${e.type} on ${e.layer} not read back`).toBeGreaterThanOrEqual(0);
    left.splice(i, 1);
  }
}

describe('DXF writer (T175)', () => {
  it('formats numbers with at most 6 decimals, no exponent, no -0', () => {
    expect(dxfNumber(0)).toBe('0');
    expect(dxfNumber(-0)).toBe('0');
    expect(dxfNumber(-0.0000001)).toBe('0');
    expect(dxfNumber(12.5)).toBe('12.5');
    expect(dxfNumber(1e-7)).toBe('0');
    expect(dxfNumber(1 / 3)).toBe('0.333333');
    expect(dxfNumber(2440)).toBe('2440');
    expect(() => dxfNumber(Number.NaN)).toThrow();
  });

  it('puts each operation on its own layer; arcs stay bulges', () => {
    const es = partsEntities(sample());
    const on = (layer: string) => es.filter((e) => e.layer === layer);
    expect(on(DXF_EXPORT_LAYERS.outside)).toHaveLength(2);
    expect(on(DXF_EXPORT_LAYERS.inside)).toHaveLength(1);
    expect(on(DXF_EXPORT_LAYERS.drill)).toHaveLength(1);
    expect(on(DXF_EXPORT_LAYERS.pocket)).toHaveLength(2); // pocket + groove
    expect(on(DXF_EXPORT_LAYERS.online)).toHaveLength(1);
    expect(on(DXF_EXPORT_LAYERS.sheet)).toHaveLength(0);
    for (const e of [...on(DXF_EXPORT_LAYERS.outside), ...on(DXF_EXPORT_LAYERS.inside)]) {
      if (e.type !== 'polyline') throw new Error('polyline expected');
      expect(e.poly.vertices.some((v) => v.bulge !== 0)).toBe(true);
    }
    const text = writeProjectDxf(sample(), 'parts');
    expect(text).toContain('\n 42\n');
    expect(text).not.toMatch(/\bARC\b|\bLWPOLYLINE\b/);
  });

  it('parts file: each part once, unrotated, side by side', () => {
    const es = partsEntities(sample());
    const outlines = es.filter((e) => e.layer === DXF_EXPORT_LAYERS.outside);
    const boxes = outlines.map((e) => bbox((e as { poly: Polyline }).poly));
    expect(boxes[0]).toEqual({ minX: 0, minY: 0, maxX: 600, maxY: 400 });
    const b1 = boxes[1] ?? { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
    expect(b1.minX).toBeCloseTo(600 + DXF_EXPORT_GAP, 6);
    expect(b1.maxY - b1.minY).toBeCloseTo(300, 6); // 150 + half circle r=150
  });

  it('layout file: sheets side by side with frames, one outline per placement', () => {
    const es = layoutEntities(sample());
    const frames = es.filter((e) => e.layer === DXF_EXPORT_LAYERS.sheet);
    expect(frames.map((e) => bbox((e as { poly: Polyline }).poly))).toEqual([
      { minX: 0, minY: 0, maxX: 2440, maxY: 1220 },
      { minX: 2440 + DXF_EXPORT_GAP, minY: 0, maxX: 2440 + DXF_EXPORT_GAP + 1200, maxY: 800 },
    ]);
    const outlines = es.filter((e) => e.layer === DXF_EXPORT_LAYERS.outside);
    expect(outlines).toHaveLength(3);
    // The rotated door on sheet 2 starts at the placement point, shifted by sheet 1 + gap.
    const b = bbox((outlines[2] as { poly: Polyline }).poly);
    expect(b.minX).toBeCloseTo(2440 + DXF_EXPORT_GAP + 10, 6);
    expect(b.minY).toBeCloseTo(10, 6);
  });

  it('round trip: our importer reads the same contours within EPS', () => {
    expectRoundTrip(partsEntities(sample()));
    expectRoundTrip(layoutEntities(sample()));
  });

  it('round trip through part recognition: same parts, holes and lines', () => {
    for (const kind of ['parts', 'layout'] as const) {
      const read = readDxf(writeProjectDxf(sample(), kind));
      if (!read.ok) throw new Error('unreadable');
      const plan = planDxfImport(read.value, DXF_EXPORT_LAYER_MAP);
      expect(plan.parts).toHaveLength(kind === 'parts' ? 2 : 3);
      expect(plan.open).toHaveLength(0);
      expect(plan.orphans).toHaveLength(0);
      const door = plan.parts.find((p) => p.inners.length > 0);
      if (!door) throw new Error('no door');
      expect(door.inners.filter((i) => i.drill)).toHaveLength(1);
      expect(door.inners.filter((i) => !i.drill)).toHaveLength(1);
      expect(door.lines).toHaveLength(1);
      expect(plan.pending).toHaveLength(kind === 'parts' ? 2 : 4); // CEP: reported, not imported
      const written = (kind === 'parts' ? partsEntities(sample()) : layoutEntities(sample()))
        .filter((e) => e.layer === DXF_EXPORT_LAYERS.outside)
        .map((e) => normalize((e as { poly: Polyline }).poly, 'outer'));
      for (const p of plan.parts) {
        expect(written.some((w) => samePoly(normalize(p.outline, 'outer'), w))).toBe(true);
      }
    }
  });

  it('is deterministic and matches the reference file', async () => {
    const text = writeProjectDxf(sample(), 'layout');
    expect(writeProjectDxf(sample(), 'layout')).toBe(text);
    await expect(text).toMatchFileSnapshot('./__fixtures__/export-layout.dxf');
    await expect(writeProjectDxf(sample(), 'parts')).toMatchFileSnapshot(
      './__fixtures__/export-parts.dxf',
    );
  });

  it('a layout export without a layout has only the header', () => {
    const p = { ...sample(), layout: { sheets: [] } };
    const text = writeProjectDxf(p, 'layout');
    expect(text).not.toMatch(/\n(POLYLINE|CIRCLE)\n/);
    expect(text.endsWith('  0\nEOF\n')).toBe(true);
  });

  it('property: random rounded rectangles at any rotation round-trip within EPS', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 2000 }),
        fc.integer({ min: 20, max: 1200 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 359_999 }).map((r) => r / 1000),
        fc.double({ min: 0, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 5000, noNaN: true }),
        (w, h, rr, rot, x, y) => {
          const p = sample();
          const r = Math.floor((Math.min(w, h) / 2 - 1) * (rr / 10));
          const door = {
            ...(p.parts[0] as Project['parts'][number]),
            params: { w, h, r },
            inners: [],
            holes: [],
            lines: [],
          };
          const es = layoutEntities({
            ...p,
            parts: [door as Project['parts'][number]],
            layout: {
              sheets: [{ placements: [{ partId: 'door', index: 0, x, y, rot, locked: false }] }],
            },
          });
          expectRoundTrip(es);
        },
      ),
      { numRuns: 60 },
    );
  });
});
