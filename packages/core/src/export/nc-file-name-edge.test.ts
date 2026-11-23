import { describe, expect, it } from 'vitest';
import { fileNameViolations } from '../gcode-check/check';
import { postConfig } from '../gcode-check/check.testing';
import { goldenProfile } from '../post/golden.testing';
import type { Project } from '../schema';
import { clone, projectOf } from '../toolpath/toolpath.testing';
import { exportNc } from './export';

// T322 tester edge cases (D-110): an old Mach3 profile version (limit 64) against the current one
// (limit 32); boundaries; Turkish project names; uniqueness under a tight limit.

function project(sheets = 1): Project {
  return clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: sheets }],
      placements: Array.from({ length: sheets }, (_, i) => [
        { partId: 'a', index: i, x: 20, y: 20, rot: 0 as const },
      ]),
    }),
  ) as Project;
}

function run(limit: number, opts: { sheets?: number; name?: string; stem?: string } = {}) {
  const machine = goldenProfile('mach3');
  machine.constraints.maxFileNameLength = limit;
  const name = opts.name ?? 'Kemal - Mutfak alt dolap 800';
  return exportNc(
    project(opts.sheets ?? 1),
    { profile: machine, version: 1, verification: 'draft' },
    postConfig('mach3'),
    {
      projectName: name,
      ...(opts.stem !== undefined ? { fileStem: opts.stem } : {}),
      revision: 19,
      revisionInFileName: true,
    },
  );
}

describe('old Mach3 version (64) vs current (32) (T322 tester)', () => {
  it('limit 64 keeps the usta 37-character name; limit 32 shortens it', () => {
    const old = run(64, { stem: 'Kemal_Mutfak_alt_dolap_800' });
    const cur = run(32, { stem: 'Kemal_Mutfak_alt_dolap_800' });
    expect(old.ok && old.files.map((f) => f.name)).toEqual([
      'Kemal_Mutfak_alt_dolap_800_r19_S1.tap',
    ]);
    expect(cur.ok).toBe(true);
    if (cur.ok) for (const f of cur.files) expect(f.name.length).toBeLessThanOrEqual(32);
  });
  it('the old 37-character name is blocked by the checker on a 32 machine', () => {
    const old = run(64, { stem: 'Kemal_Mutfak_alt_dolap_800' });
    if (!old.ok) throw new Error('export failed');
    expect(fileNameViolations(old.files, 32).map((v) => v.code)).toEqual(['FILE_NAME_TOO_LONG']);
  });
});

describe('file name boundaries (T322 tester)', () => {
  it('exactly the limit passes, one over fails', () => {
    const n = 'A'.repeat(28) + '.tap';
    expect(fileNameViolations([{ name: n }], 32)).toEqual([]);
    expect(fileNameViolations([{ name: `B${n}` }], 32).map((v) => v.code)).toEqual([
      'FILE_NAME_TOO_LONG',
    ]);
  });
  it('spaces and path separators are refused', () => {
    expect(fileNameViolations([{ name: 'a b.tap' }], 32)).toHaveLength(1);
    expect(fileNameViolations([{ name: '../a.tap' }], 32)).toHaveLength(1);
  });
  it('many sheets under a tight limit: names unique, within the limit, checker clean', () => {
    const r = run(12, { sheets: 12, stem: 'Kemal_Mutfak' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.files.map((f) => f.name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(fileNameViolations(r.files, 12)).toEqual([]);
  });
});
