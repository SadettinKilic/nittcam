import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import cabinetDoors from './__fixtures__/cabinet-doors.json';
import mixed from './__fixtures__/mixed.json';
import shelfSet from './__fixtures__/shelf-set.json';
import {
  formatPath,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrate,
  ProjectSchemaError,
} from './index';

describe('migrate', () => {
  it('latest version is 2 with one step (v1 → v2, D-034)', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(2);
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
  });

  it.each([
    ['cabinetDoors', cabinetDoors],
    ['shelfSet', shelfSet],
    ['mixed', mixed],
  ])('v1 → v2 maps grainLock to part grain and keeps the rest: %s', (_name, json) => {
    const v2 = migrate(json);
    const v1 = json as unknown as {
      stock: { sheet: { grain: number } };
      parts: { grainLock: boolean }[];
    };
    const sheetGrain = v1.stock.sheet.grain;
    expect(v2.schemaVersion).toBe(2);
    expect(v2.stock.sheet.grain).toBe(sheetGrain);
    v2.parts.forEach((part, i) => {
      const locked = v1.parts[i]?.grainLock;
      expect(part.grain).toEqual(
        locked ? { mode: 'fixed', angle: sheetGrain } : { mode: 'free', angle: 0 },
      );
      expect('grainLock' in part).toBe(false);
      const rest: Record<string, unknown> = { ...part };
      delete rest['grain'];
      const restV1: Record<string, unknown> = { ...v1.parts[i] };
      delete restV1['grainLock'];
      expect(rest).toEqual(restV1);
    });
    expect(v2.layout).toEqual((json as { layout: unknown }).layout);
  });

  it('v1 → v2 locks to 90 on a 90° sheet and keeps placements unchanged', () => {
    const v1 = {
      ...cabinetDoors,
      stock: { ...cabinetDoors.stock, sheet: { ...cabinetDoors.stock.sheet, grain: 90 } },
    };
    const v2 = migrate(v1);
    expect(
      v2.parts.filter((p) => p.grain.mode === 'fixed').every((p) => p.grain.angle === 90),
    ).toBe(true);
  });

  it('a v2 document with grainLock is rejected (the alias lives only in commands)', () => {
    const v2 = migrate(cabinetDoors);
    const bad = JSON.parse(JSON.stringify(v2)) as { parts: Record<string, unknown>[] };
    if (bad.parts[0]) bad.parts[0]['grainLock'] = true;
    expect(() => migrate(bad)).toThrow(/grainLock/);
  });

  it.each([
    ['cabinetDoors', cabinetDoors],
    ['shelfSet', shelfSet],
    ['mixed', mixed],
  ])('is idempotent on v1: %s', (_name, json) => {
    const once = migrate(json);
    expect(migrate(once)).toEqual(once);
    expect(migrate(migrate(once))).toEqual(once);
  });

  it('throws a clear error for a missing schemaVersion', () => {
    const json: Record<string, unknown> = { ...cabinetDoors };
    delete json['schemaVersion'];
    expect(() => migrate(json)).toThrow(ProjectSchemaError);
    expect(() => migrate(json)).toThrow(/schemaVersion: schemaVersion is missing/);
  });

  it('throws a clear error for any future schemaVersion', () => {
    fc.assert(
      fc.property(fc.integer({ min: LATEST_SCHEMA_VERSION + 1, max: 1_000_000 }), (v) => {
        expect(() => migrate({ ...cabinetDoors, schemaVersion: v })).toThrow(
          new RegExp(`schemaVersion ${v} is newer`),
        );
      }),
    );
  });

  it('carries the issue list on the error', () => {
    try {
      migrate({ ...cabinetDoors, nesting: { mode: 'minWaste', gap: -1, margin: 10 } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectSchemaError);
      expect((e as ProjectSchemaError).issues).toEqual([
        { path: 'nesting.gap', message: 'must be zero or a positive length in mm' },
      ]);
    }
  });
});

describe('formatPath', () => {
  it('formats keys and indices', () => {
    expect(formatPath([])).toBe('(root)');
    expect(formatPath(['parts', 0, 'holes', 12, 'd'])).toBe('parts[0].holes[12].d');
    expect(formatPath([3])).toBe('[3]');
  });
});
