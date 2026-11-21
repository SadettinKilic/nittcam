import { describe, expect, it } from 'vitest';
import { fileNameViolations } from '../gcode-check/check';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import type { Project } from '../schema';
import { clone, projectOf } from '../toolpath/toolpath.testing';
import { exportNc } from './export';

// T322 (usta 1): `Kemal_Mutfak_alt_dolap_800_r19_S1.tap` (37 chars) on a machine whose profile
// says 32. The NC file name respects the profile's limit.

function project(sheets = 1): Project {
  return clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: sheets }],
      placements: Array.from({ length: sheets }, () => [
        { partId: 'a', index: 0, x: 20, y: 20, rot: 0 as const },
      ]).map((s, i) => s.map((p) => ({ ...p, index: i }))),
    }),
  ) as Project;
}

function names(limit: number, sheets = 1): string[] {
  const machine = goldenProfile('mach3');
  machine.constraints.maxFileNameLength = limit;
  const r = exportNc(
    project(sheets),
    { profile: machine, version: 1, verification: 'draft' },
    postConfig('mach3'),
    {
      projectName: 'Kemal - Mutfak alt dolap 800',
      fileStem: 'Kemal_Mutfak_alt_dolap_800',
      revision: 19,
      revisionInFileName: true,
    },
  );
  expect(r.ok, JSON.stringify(r.ok ? [] : r)).toBe(true);
  return r.ok ? r.files.map((f) => f.name) : [];
}

describe('NC file name length (T322)', () => {
  it('a 32-character profile limit shortens the project part, keeps revision and sheet', () => {
    const [name] = names(32);
    expect(name).toBeDefined();
    expect(name?.length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/_r19_S1\.tap$/);
  });
});

describe('NC file names stay unique and short (T322)', () => {
  it('two sheets under a 32 limit: distinct names, each within the limit', () => {
    const list = names(32, 2);
    expect(list).toHaveLength(2);
    expect(new Set(list).size).toBe(2);
    for (const n of list) expect(n.length).toBeLessThanOrEqual(32);
  });
  it('a very short limit drops the revision before failing; the sheet marker stays', () => {
    expect(names(10)).toEqual(['Kem_S1.tap']);
    expect(names(8)).toEqual(['K_S1.tap']);
  });
  it('the names are the same on every run (deterministic)', () => {
    expect(names(20, 2)).toEqual(names(20, 2));
  });
});

describe('fileNameViolations: the independent checker (T322)', () => {
  it('a 37-character name for a 32-character machine is an error', () => {
    const v = fileNameViolations([{ name: 'Kemal_Mutfak_alt_dolap_800_r19_S1.tap' }], 32);
    expect(v.map((x) => x.code)).toEqual(['FILE_NAME_TOO_LONG']);
    expect(v[0]?.severity).toBe('error');
  });
  it('Turkish or other non-ASCII letters and duplicates are errors', () => {
    const v = fileNameViolations(
      [{ name: 'Çekmece_S1.tap' }, { name: 'a_S1.tap' }, { name: 'A_S1.TAP' }],
      32,
    );
    expect(v.map((x) => x.code)).toEqual(['FILE_NAME_CHARS', 'FILE_NAME_DUPLICATE']);
  });
  it('a short ASCII name passes', () => {
    expect(fileNameViolations([{ name: 'Mutfak_r3_S1.tap' }], 32)).toEqual([]);
  });
});
