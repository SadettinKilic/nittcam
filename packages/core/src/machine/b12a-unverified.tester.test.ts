/**
 * B12a tester (T265, spec §7.2): a parameter set marked `unverified` (generic starting values from
 * the "Kesim ayarı ekle" fix flow) never reaches a machine through any G-code entry point: the
 * server export (`exportNc`), the simulation (`simulateProject`), a full `options.cutting`
 * override, and the test-cut / air-cut program (`testProgram`). Control: the same project with the
 * mark removed exports.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { postConfig } from '../gcode-check/check.testing';
import { exportNc } from '../export';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { simulateProject } from '../simulation/simulate';
import { testProgram } from '../testcut/program';
import { buildToolpath } from '../toolpath';
import { validateProject } from '../validate';
import { findMaterialParams, type MachineProfile } from './index';

type Post = 'generic' | 'mach3';
const POSTS: Post[] = ['generic', 'mach3'];

/** The golden profile with the set used by `stock` marked unverified. */
function marked(post: Post): MachineProfile {
  const p = goldenProfile(post);
  const set = findMaterialParams(p, { material: 'mdf', thickness: 18 });
  return { ...p, materials: p.materials.map((m) => (m === set ? { ...m, unverified: true } : m)) };
}
const pv = (profile: MachineProfile) => ({ profile, version: 1, verification: 'draft' as const });
const project = goldenProject(shelfSet, 8);

describe('B12a tester: unverified set blocks every G-code path (T265)', () => {
  it.each(POSTS)('%s: control, the unmarked profile exports', (post) => {
    const r = exportNc(project, pv(goldenProfile(post)), postConfig(post));
    expect(r.ok).toBe(true);
    expect(r.files.length).toBeGreaterThan(0);
  });

  it.each(POSTS)('%s: exportNc stops at the toolpath, no files', (post) => {
    const r = exportNc(project, pv(marked(post)), postConfig(post));
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('toolpath');
    expect(r.files).toEqual([]);
    expect(r.toolpathIssues.map((i) => i.code)).toContain('CUTTING_PARAMS_UNVERIFIED');
  });

  it.each(POSTS)('%s: simulateProject has no program', (post) => {
    const r = simulateProject(project, pv(marked(post)), postConfig(post));
    expect(r.ok).toBe(false);
    expect(r.sheets).toEqual([]);
  });

  it('a full options.cutting override does not bypass the mark', () => {
    const r = buildToolpath(project, marked('generic'), {
      cutting: { tool: 1, feed: 6000, plungeFeed: 1500, rpm: 18000, passDepth: 6 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('CUTTING_PARAMS_UNVERIFIED');
    expect(r.toolpath.operations).toEqual([]);
  });

  it.each(['airCut', 'testCut'] as const)('%s program for the unverified set: no files', (kind) => {
    const profile = marked('generic');
    const index = profile.materials.findIndex((m) => m.unverified);
    const r = testProgram(kind, pv(profile), postConfig('generic'), { materialIndex: index });
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('property: whichever set is marked, a project on it never gets a toolpath', () => {
    const base = goldenProfile('generic');
    fc.assert(
      fc.property(fc.integer({ min: 0, max: base.materials.length - 1 }), (i) => {
        const target = base.materials[i];
        if (!target) return;
        const profile = {
          ...base,
          materials: base.materials.map((m, j) =>
            j === i ? { ...m, unverified: true as const } : m,
          ),
        };
        const p = {
          ...project,
          stock: { ...project.stock, material: target.material, thickness: target.thickness },
        };
        // The set the project resolves to is the marked one only when it is the first match.
        const resolved = findMaterialParams(profile, p.stock);
        const tp = buildToolpath(p, profile);
        const codes = validateProject(p, { machine: profile }).map((x) => x.code);
        if (resolved?.unverified) {
          expect(tp.ok).toBe(false);
          expect(tp.errors.map((e) => e.code)).toContain('CUTTING_PARAMS_UNVERIFIED');
          expect(codes).toContain('CUTTING_PARAMS_UNVERIFIED');
        } else {
          expect(tp.errors.map((e) => e.code)).not.toContain('CUTTING_PARAMS_UNVERIFIED');
        }
      }),
      { numRuns: 50 },
    );
  });
});
