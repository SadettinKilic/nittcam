/**
 * T191 tester (gcode-safety): the extended air cut is the test cut raised as a whole. Every read
 * move stays at or above the 20 mm floor, the holes, pocket and groove are still traced (same XY
 * path as the test cut, same constant lift on every feed move), and a single hole / pocket /
 * groove / inner move brought below the floor is refused by the automatic check (R3), never downloadable.
 */
import { describe, expect, it } from 'vitest';
import { canDownload } from '../gcode-check';
import { postAndCheck } from '../export/export';
import { readGcode } from '../gcode-reader';
import type { MachineProfile } from '../machine';
import { goldenProfile, GOLDEN_POSTS } from '../post/golden.testing';
import { buildToolpath, type Toolpath } from '../toolpath';
import { AIR_CUT_GAP, airCutToolpath } from './program';
import { extendedTestProgram, extendedTestProject } from './extended';

type Post = 'generic' | 'mach3';
const config = (post: Post) => GOLDEN_POSTS.find((p) => p.id === post)?.config;

function program(kind: 'airCut' | 'testCut', post: Post) {
  const profile = goldenProfile(post);
  return extendedTestProgram(kind, { profile, version: 3, verification: 'draft' }, config(post));
}

function feeds(text: string) {
  return readGcode(text, { strict: true }).moves.filter((m) => m.type !== 'rapid');
}

function airToolpath(profile: MachineProfile): Toolpath {
  const set = profile.materials[0];
  if (!set) throw new Error('no set');
  const tool = profile.tools.find((t) => t.number === set.tool);
  const tp = buildToolpath(extendedTestProject(set, tool?.diameter ?? 6), profile);
  if (!tp.ok) throw new Error('toolpath');
  return airCutToolpath(tp.toolpath);
}

describe.each(['generic', 'mach3'] as const)('T191 tester, %s post', (post) => {
  it('air cut: every read move ≥ 20 mm, the same XY path as the test cut, one constant lift', () => {
    const air = program('airCut', post);
    const cut = program('testCut', post);
    expect(air.ok && cut.ok).toBe(true);
    const airText = air.files[0]?.content ?? '';
    expect(airText.split('\n')[0]).toContain('DOGRULANMADI');
    const all = readGcode(airText, { strict: true });
    expect(all.errors).toEqual([]);
    for (const m of all.moves) {
      if (m.assumedAxes.includes('z')) continue;
      expect(m.to.z).toBeGreaterThanOrEqual(AIR_CUT_GAP - 1e-6);
    }
    const a = feeds(airText);
    const c = feeds(cut.files[0]?.content ?? '');
    expect(a.length).toBe(c.length);
    expect(a.length).toBeGreaterThan(0);
    const lift = (a[0]?.to.z ?? 0) - (c[0]?.to.z ?? 0);
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      const q = c[i];
      if (!p || !q) throw new Error('move');
      expect(p.to.x).toBeCloseTo(q.to.x, 3);
      expect(p.to.y).toBeCloseTo(q.to.y, 3);
      expect(p.to.z - q.to.z).toBeCloseTo(lift, 3);
    }
    // The deepest test-cut move (through, below the stock bottom) lands exactly on the floor.
    expect(Math.min(...a.map((m) => m.to.z))).toBeCloseTo(AIR_CUT_GAP, 3);
  });

  // Through holes Ø12 are milled as pockets: 2 holes + the Ø35 blind pocket = 3 pocket operations.
  it.each([
    ['pocket', 0],
    ['pocket', 1],
    ['pocket', 2],
    ['groove', 0],
    ['innerContour', 0],
  ] as const)('one %s #%i move below the floor is refused (R3), no file', (kind, nth) => {
    const profile = goldenProfile(post);
    const tp = airToolpath(profile);
    const op = tp.operations.filter((o) => o.kind === kind)[nth];
    expect(op, `${kind} in [${tp.operations.map((o) => o.kind).join(',')}]`).toBeDefined();
    const lowered: Toolpath = {
      ...tp,
      operations: tp.operations.map((o) =>
        o !== op
          ? o
          : {
              ...o,
              segments: o.segments.map((s, si) =>
                si !== 0
                  ? s
                  : {
                      ...s,
                      moves: s.moves.map((m) =>
                        m.kind === 'rapid' ? m : { ...m, z: Math.min(m.z, AIR_CUT_GAP - 0.5) },
                      ),
                    },
              ),
            },
      ),
    };
    const r = postAndCheck(
      lowered,
      [],
      { profile, version: 3, verification: 'draft' },
      config(post),
      {
        projectName: 'AIRCUT',
        revision: 0,
        fileStem: 'AIRCUT',
        stock: { material: 'MDF', thickness: 18, sheetWidth: 600, sheetHeight: 400 },
        layout: null,
        zFloor: AIR_CUT_GAP,
      },
    );
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
    expect((r.check?.violations ?? []).map((v) => `${v.rule}/${v.code}`)).toContain(
      'R3/AIR_CUT_BELOW_FLOOR',
    );
    expect(r.check ? canDownload(r.check) : false).toBe(false);
  });
});
