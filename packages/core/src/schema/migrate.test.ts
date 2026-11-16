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
  it('latest version is 1 and needs no steps', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(1);
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it.each([
    ['cabinetDoors', cabinetDoors],
    ['shelfSet', shelfSet],
    ['mixed', mixed],
  ])('v1 is an identity: %s', (_name, json) => {
    expect(migrate(json)).toEqual(json);
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
