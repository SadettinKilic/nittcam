/**
 * Tester read-back of the sample project NC (T184, gcode-safety): the independent reader
 * reads every exported file and the motion stays inside the sample machine's envelope.
 */
import { exampleMachineProfile, exportNc, nestProject, readGcode } from '@nittcam/core';
import { POST_CONFIGS } from '@nittcam/machines';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import { buildSampleProject } from './sample-project';

const machine = {
  id: '7b0c3c5e-1111-4000-8000-000000000001',
  version: 1,
  profile: exampleMachineProfile(),
};

function exportSample() {
  let n = 0;
  const res = buildSampleProject(
    machine,
    [],
    { group: 'Örnek dolap', roles: tr.cutList.cabinet.roles },
    () => `p${++n}`,
    '2026-11-20T10:00:00.000Z',
  );
  if (!res) throw new Error('sample not built');
  const nested = { ...res.project, layout: nestProject(res.project, { toolDiameter: 8 }).layout };
  const r = exportNc(
    nested,
    { profile: machine.profile, version: 1, verification: 'draft' },
    POST_CONFIGS[machine.profile.post.id],
  );
  return { project: res.project, r };
}

describe('sample project NC read-back (T184, tester)', () => {
  it('every file reads without errors and stays inside table, depth and rapid limits', () => {
    const { project, r } = exportSample();
    expect(r.ok).toBe(true);
    const maxThickness = project.stock.thickness;
    const allowance = machine.profile.zZero.spoilboardAllowance;
    const { width, depth } = machine.profile.table;
    for (const f of r.files) {
      const read = readGcode(f.content);
      expect(read.errors, f.name).toEqual([]);
      expect(read.moves.length, f.name).toBeGreaterThan(0);
      let sawCut = false;
      for (const m of read.moves) {
        const p = m.to;
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(width + 1e-6);
        expect(p.y).toBeLessThanOrEqual(depth + 1e-6);
        // material-top zero: never deeper than a through cut plus the spoilboard allowance
        expect(p.z).toBeGreaterThanOrEqual(-(maxThickness + allowance) - 1e-6);
        if (m.type === 'rapid') {
          // a rapid never ends in material; a sideways rapid also never starts there
          // (a straight-up retract out of a pocket is fine)
          expect(p.z, `line ${m.line}`).toBeGreaterThanOrEqual(-1e-6);
          const sideways = Math.hypot(p.x - m.from.x, p.y - m.from.y) > 1e-6;
          if (sideways) expect(m.from.z, `line ${m.line}`).toBeGreaterThanOrEqual(-1e-6);
        } else {
          sawCut = true;
          expect(m.rpm ?? 0, `spindle on at line ${m.line}`).toBeGreaterThan(0);
          expect(m.feed ?? 0, `feed at line ${m.line}`).toBeGreaterThan(0);
        }
      }
      expect(sawCut).toBe(true);
    }
  });
});
