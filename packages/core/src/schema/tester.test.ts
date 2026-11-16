/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate raw JSON freely */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import cabinetDoors from './__fixtures__/cabinet-doors.json';
import mixed from './__fixtures__/mixed.json';
import shelfSet from './__fixtures__/shelf-set.json';
import { deriveOutline, parseProject, rectOutline, type Part, type Project } from './index';

const clone = (j: unknown): any => JSON.parse(JSON.stringify(j));

function ok(json: unknown): Project {
  const r = parseProject(json);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.issues)}`);
  return r.project;
}

const rotArb = fc.constantFrom(0, 90, 180, 270);
const mm = fc.double({ min: 1, max: 3000, noNaN: true, noDefaultInfinity: true });

const partArb = (id: string): fc.Arbitrary<any> =>
  fc
    .record({
      qty: fc.integer({ min: 1, max: 5 }),
      w: mm,
      h: mm,
      rf: fc.double({ min: 0, max: 1, noNaN: true }),
      grainLock: fc.boolean(),
      bands: fc.array(fc.double({ min: 0, max: 3, noNaN: true }), { minLength: 4, maxLength: 4 }),
      holeD: mm,
      depth: mm,
    })
    .map((p) => ({
      id,
      name: id,
      qty: p.qty,
      grainLock: p.grainLock,
      kind: 'rect',
      params: { w: p.w, h: p.h, r: (Math.min(p.w, p.h) / 2) * p.rf },
      inners: [],
      holes: [{ id: 'h1', type: 'pocket', d: p.holeD, cx: 1, cy: 2, depth: p.depth, tool: 2 }],
      edgeBand: { top: p.bands[0], right: p.bands[1], bottom: p.bands[2], left: p.bands[3] },
      templates: [],
    }));

const projectArb: fc.Arbitrary<any> = fc
  .record({
    a: partArb('a'),
    b: partArb('b'),
    rot: rotArb,
    x: fc.double({ min: -100, max: 3000, noNaN: true }),
    y: fc.double({ min: -100, max: 3000, noNaN: true }),
    grain: fc.constantFrom(0, 90),
    mode: fc.constantFrom('minWaste', 'fastest', 'minToolChanges'),
    dim: fc.constantFrom('cut', 'finished'),
    off: fc.boolean(),
  })
  .map((g) => ({
    schemaVersion: 1,
    machine: { machineId: 'm1', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2100, grain: g.grain },
      useOffcuts: g.off,
    },
    parts: [g.a, g.b],
    nesting: { mode: g.mode, gap: 8, margin: 10 },
    layout: {
      sheets: [
        {
          placements: [
            { partId: 'a', index: g.a.qty - 1, x: g.x + 0, y: g.y + 0, rot: g.rot, locked: true },
            { partId: 'b', index: 0, x: 0, y: 0, rot: 0, locked: false },
          ],
        },
      ],
    },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: g.dim },
  }));

describe('tester: round trip (T004)', () => {
  it('fast-check: generated projects survive JSON round trip unchanged', () => {
    fc.assert(
      fc.property(projectArb, (raw) => {
        const first = ok(raw);
        const second = ok(JSON.parse(JSON.stringify(first)));
        expect(second).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });

  it.each([
    ['cabinetDoors', cabinetDoors],
    ['shelfSet', shelfSet],
    ['mixed', mixed],
  ])('fixture %s round-trips', (_n, fx) => {
    const first = ok(fx);
    expect(ok(JSON.parse(JSON.stringify(first)))).toEqual(first);
  });
});

describe('tester: deriveOutline', () => {
  it('freeform part returns its own outline unchanged (as a copy)', () => {
    const p = ok(mixed).parts.find((x) => x.kind === 'freeform') as Part & { kind: 'freeform' };
    const out = deriveOutline(p);
    expect(out).toEqual(p.outline);
    expect(out).not.toBe(p.outline);
  });

  it('rect with r = min(w,h)/2 (stadium, circle) stays valid and closed', () => {
    const base = clone(cabinetDoors);
    for (const [w, h] of [
      [200, 100],
      [100, 100],
      [100, 200],
    ] as const) {
      const r = Math.min(w, h) / 2;
      const raw = clone(base);
      raw.parts[0].params = { w, h, r };
      delete raw.parts[0].outline;
      raw.layout.sheets = [{ placements: [] }];
      const part = ok(raw).parts[0] as Part;
      const o = deriveOutline(part);
      expect(o.length).toBeGreaterThanOrEqual(4);
      for (const v of o) {
        expect(v.x).toBeGreaterThanOrEqual(0);
        expect(v.x).toBeLessThanOrEqual(w);
        expect(v.y).toBeGreaterThanOrEqual(0);
        expect(v.y).toBeLessThanOrEqual(h);
      }
      // no zero-length straight edge
      o.forEach((v, i) => {
        const n = o[(i + 1) % o.length] as (typeof o)[number];
        expect(v.bulge === 0 && v.x === n.x && v.y === n.y).toBe(false);
      });
      // a circle is made of 4 arcs
      if (w === h) expect(o.every((v) => v.bulge !== 0)).toBe(true);
      // the derived outline re-validates as a freeform contour
      const ff = clone(raw);
      ff.parts[0] = { ...ff.parts[0], kind: 'freeform', outline: o };
      delete ff.parts[0].params;
      expect(parseProject(ff).ok).toBe(true);
    }
    expect(rectOutline({ w: 100, h: 100, r: 50 })).toHaveLength(4);
  });

  it('r just above min(w,h)/2 is rejected', () => {
    const raw = clone(cabinetDoors);
    raw.parts[0].params = { w: 100, h: 200, r: 50.001 };
    expect(parseProject(raw).ok).toBe(false);
  });
});

describe('tester: holes and layout cross references', () => {
  it('FINDING (spec 4.5): pocket depth >= stock thickness is NOT rejected by the schema (D-010 defers it)', () => {
    const raw = clone(cabinetDoors);
    raw.parts[0].holes[0].depth = raw.stock.thickness + 5;
    expect(parseProject(raw).ok).toBe(true);
    raw.parts[0].holes[0].depth = raw.stock.thickness;
    expect(parseProject(raw).ok).toBe(true);
  });

  it('placement with index >= qty is rejected with a readable path', () => {
    const raw = clone(cabinetDoors);
    const part = raw.parts[0];
    raw.layout.sheets = [
      { placements: [{ partId: part.id, index: part.qty, x: 0, y: 0, rot: 0, locked: false }] },
    ];
    const r = parseProject(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const i = r.issues.find((x) => x.path === 'layout.sheets[0].placements[0].index');
      expect(i?.message).toMatch(/out of range/);
    }
  });

  it('placement with index = qty - 1 is accepted; negative index rejected', () => {
    const raw = clone(cabinetDoors);
    const part = raw.parts[0];
    raw.layout.sheets = [
      { placements: [{ partId: part.id, index: part.qty - 1, x: 0, y: 0, rot: 0, locked: false }] },
    ];
    expect(parseProject(raw).ok).toBe(true);
    raw.layout.sheets[0].placements[0].index = -1;
    expect(parseProject(raw).ok).toBe(false);
  });

  it('settings.dimensionMode defaults to cut when settings is missing', () => {
    const raw = clone(cabinetDoors);
    delete raw.settings;
    expect(ok(raw).settings.dimensionMode).toBe('cut');
  });
});
