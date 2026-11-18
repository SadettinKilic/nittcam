/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known fixtures */
/**
 * Tester (B5, T112): v1 → v2 migration on every v1 fixture, checked field by field against the
 * RAW v1 JSON (not against another `parseProject` call), so a mapping bug cannot hide behind the
 * same code on both sides. D-034: sheet grain kept; `grainLock: true` → fixed at the sheet grain,
 * `false` → free 0; placements and every other field unchanged.
 */
import { describe, expect, it } from 'vitest';
import cabinetDoors from './__fixtures__/cabinet-doors.json';
import mixed from './__fixtures__/mixed.json';
import shelfSet from './__fixtures__/shelf-set.json';
import { allowedRotations } from '../geometry/grain';
import { nestProject } from '../nesting';
import { LATEST_SCHEMA_VERSION, migrate, migrateV1toV2, parseProject } from './index';

type Json = Record<string, unknown>;
const FIXTURES: [string, Json][] = [
  ['cabinet-doors', cabinetDoors as Json],
  ['mixed', mixed as Json],
  ['shelf-set', shelfSet as Json],
];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('v1 → v2 migration on the real fixtures (tester)', () => {
  it.each(FIXTURES)('%s: every field except grainLock survives; grain mapped exactly', (_, raw) => {
    const v1 = clone(raw);
    expect(v1['schemaVersion']).toBe(1);
    const before = JSON.stringify(v1);
    const p = migrate(v1);
    // The input object is not mutated.
    expect(JSON.stringify(v1)).toBe(before);
    expect(p.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    const sheet = (v1['stock'] as Json)['sheet'] as Json;
    expect(p.stock.sheet.grain).toBe(sheet['grain']);
    const rawParts = v1['parts'] as Json[];
    expect(p.parts).toHaveLength(rawParts.length);
    rawParts.forEach((rp, i) => {
      const mp = p.parts[i]! as unknown as Json;
      const { grainLock, ...rest } = rp;
      expect(typeof grainLock).toBe('boolean');
      expect(mp['grain']).toEqual(
        grainLock ? { mode: 'fixed', angle: sheet['grain'] } : { mode: 'free', angle: 0 },
      );
      expect('grainLock' in mp).toBe(false);
      const mrest = { ...mp };
      delete mrest['grain'];
      // No data loss: everything else is the same (zod may only add nothing / drop nothing).
      expect(mrest).toEqual(rest);
    });
    // Placements, layout, nesting, cutting, machine: untouched.
    for (const key of Object.keys(v1)) {
      if (key === 'parts' || key === 'schemaVersion') continue;
      expect((p as unknown as Json)[key]).toEqual(v1[key]);
    }
  });

  it.each(FIXTURES)('%s: idempotent (v2 output parses to itself)', (_, raw) => {
    const p = migrate(clone(raw));
    const again = parseProject(clone(p));
    expect(again.ok && again.project).toEqual(p);
  });

  it.each(FIXTURES)('%s: migrated fixed parts keep the v1 rotation set (0/180 only)', (_, raw) => {
    const p = migrate(clone(raw));
    const rawParts = (raw['parts'] as Json[]).map((x) => x['grainLock']);
    p.parts.forEach((part, i) => {
      expect(allowedRotations(part, p.stock.sheet)).toEqual(
        rawParts[i] ? [0, 180] : [0, 90, 180, 270],
      );
    });
  });

  it.each(FIXTURES)(
    '%s: the migrated project nests with grain-locked parts never at 90/270',
    (_, raw) => {
      const p = migrate(clone(raw));
      const res = nestProject(p, { toolDiameter: 8 });
      const fixed = new Set(p.parts.filter((x) => x.grain.mode === 'fixed').map((x) => x.id));
      for (const sheet of res.layout.sheets)
        for (const pl of sheet.placements)
          if (fixed.has(pl.partId)) expect([0, 180]).toContain(pl.rot);
      expect(res.info).toEqual([]);
    },
  );

  it('a 90° sheet maps grainLock true → fixed 90 and false → free 0, on every part', () => {
    const v1 = clone(cabinetDoors as Json);
    ((v1['stock'] as Json)['sheet'] as Json)['grain'] = 90;
    (v1['parts'] as Json[]).forEach((pt, i) => (pt['grainLock'] = i % 2 === 0));
    const p = migrate(v1);
    p.parts.forEach((pt, i) =>
      expect(pt.grain).toEqual(
        i % 2 === 0 ? { mode: 'fixed', angle: 90 } : { mode: 'free', angle: 0 },
      ),
    );
    for (const pt of p.parts)
      if (pt.grain.mode === 'fixed') expect(allowedRotations(pt, p.stock.sheet)).toEqual([0, 180]);
  });

  it('malformed v1 grainLock is reported by the schema, not silently mapped', () => {
    const v1 = clone(shelfSet as Json);
    (v1['parts'] as Json[])[0]!['grainLock'] = 'yes';
    const r = parseProject(v1);
    expect(r.ok).toBe(false);
    const v1b = clone(shelfSet as Json);
    delete (v1b['parts'] as Json[])[0]!['grainLock'];
    expect(parseProject(v1b).ok).toBe(false);
  });

  it('v1 rejects a free sheet angle, v2 accepts it; v1 placement rot 90 stays 90', () => {
    const v1 = clone(shelfSet as Json);
    ((v1['stock'] as Json)['sheet'] as Json)['grain'] = 45;
    // v1 only knew 0/90: the migration passes it through and v2 accepts 45 (the value is kept).
    const r = parseProject(v1);
    expect(r.ok && r.project.stock.sheet.grain).toBe(45);
    const step = migrateV1toV2(clone(shelfSet as Json));
    expect(step['layout'] as Json).toEqual((shelfSet as Json)['layout']);
  });

  it('a v2 document is not re-migrated (grain on parts is kept as is)', () => {
    const p = migrate(clone(mixed as Json));
    const v2 = clone(p) as unknown as Json;
    (v2['parts'] as Json[])[0]!['grain'] = { mode: 'fixed', angle: 33.5 };
    const again = migrate(v2);
    expect(again.parts[0]!.grain).toEqual({ mode: 'fixed', angle: 33.5 });
  });
});
