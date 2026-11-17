/**
 * exportNc (T019): toolpath → G-code → automatic checks; files only when everything passes.
 * A generator fault is simulated by mocking `generateGcode` so that it hands out (and checks)
 * a deliberately broken program; the pipeline must return no files.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canDownload } from '../gcode-check';
import { postConfig } from '../gcode-check/check.testing';
import { golden } from '../gcode-check/check.testing';
import type { GenerateOptions, PostFile, PostResult } from '../post';
import { exportNc } from './export';

const fault = vi.hoisted(() => ({
  mutate: null as null | ((content: string) => string),
  /** Hand out broken files without calling the check hook (a generator that ignores it). */
  skipHook: false,
}));

vi.mock('../post/generate', async (importActual) => {
  const actual = await importActual<typeof import('../post/generate')>();
  return {
    ...actual,
    generateGcode: (...args: Parameters<typeof actual.generateGcode>): PostResult => {
      const mutate = fault.mutate;
      if (!mutate) return actual.generateGcode(...args);
      const clean = actual.generateGcode(args[0], args[1], args[2], args[3], {});
      const files: PostFile[] = clean.files.map((f) => ({ ...f, content: mutate(f.content) }));
      const opts: GenerateOptions = args[4] ?? {};
      if (!fault.skipHook && opts.check) {
        const found = opts.check(files).filter((i) => i.severity === 'error');
        if (found.length > 0) {
          return {
            ok: false,
            files: [],
            errors: found.map((i) => ({ ...i, code: 'CHECK_FAILED' as const, rule: 9 })),
            warnings: [],
          };
        }
      }
      return { ...clean, files };
    },
  };
});

describe('exportNc', () => {
  beforeEach(() => {
    fault.mutate = null;
    fault.skipHook = false;
  });

  it.each(['generic', 'mach3'] as const)(
    '%s: a clean project exports, files equal the golden file',
    (post) => {
      const g = golden(post, 'mixed');
      const r = exportNc(
        g.project,
        { profile: g.context.profile, version: 1, verification: 'draft' },
        postConfig(post),
        {
          projectName: 'Karışık (dikdörtgen alt küme)',
          revision: 1,
          fileStem: 'mixed',
        },
      );
      expect(r.postErrors).toEqual([]);
      expect(r.check?.violations).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.stage).toBe('done');
      expect(r.files).toHaveLength(1);
      expect(r.files[0]?.content).toBe(g.text);
      expect(r.check && canDownload(r.check)).toBe(true);
    },
  );

  it('is deterministic', () => {
    const g = golden('generic', 'shelf-set');
    const pv = { profile: g.context.profile, version: 1, verification: 'draft' as const };
    expect(exportNc(g.project, pv, postConfig('generic'))).toEqual(
      exportNc(g.project, pv, postConfig('generic')),
    );
  });

  const BROKEN: [string, (c: string) => string, string][] = [
    ['rapid into the material', (c) => c.replace(/G1 (Z-[\d.]+) F1500/, 'G0 $1'), 'R3'],
    ['no warm-up', (c) => c.replace(/G4 P[\d.]+\r\n/, ''), 'R4'],
    [
      'arc centre shifted',
      (c) =>
        c.replace(
          /(G[23] X\S+ Y\S+ I)(-?[\d.]+)/,
          (_, a: string, i: string) => `${a}${(Number(i) + 0.3).toFixed(3)}`,
        ),
      'R9',
    ],
    ['header removed', (c) => c.replace(/^\(DOGRULANMADI[^\r]*\r\n/, ''), 'R10'],
  ];

  it.each(BROKEN)('a generator fault (%s) gives no files, stage check', (_name, mutate, rule) => {
    fault.mutate = mutate;
    const g = golden('generic', 'mixed');
    const r = exportNc(
      g.project,
      { profile: g.context.profile, version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.stage).toBe('check');
    expect(r.check?.ok).toBe(false);
    expect(r.check?.violations.map((v) => v.rule)).toContain(rule);
    expect(r.postErrors.every((e) => e.code === 'CHECK_FAILED' && e.rule === 9)).toBe(true);
  });

  it('a generator that ignores the check hook is still caught by the re-check', () => {
    fault.mutate = (c) => c.replace(/\r\nM5\r\n/, '\r\n');
    fault.skipHook = true;
    const g = golden('mach3', 'mixed');
    const r = exportNc(
      g.project,
      { profile: g.context.profile, version: 1, verification: 'draft' },
      postConfig('mach3'),
    );
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.stage).toBe('check');
    expect(r.check?.violations.map((v) => v.code)).toContain('END_SPINDLE_ON');
  });

  it('a toolpath error stops before the post (no files)', () => {
    const g = golden('generic', 'mixed');
    const profile = structuredClone(g.context.profile);
    profile.materials = [];
    const r = exportNc(
      g.project,
      { profile, version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('toolpath');
    expect(r.files).toEqual([]);
    expect(r.check).toBeNull();
  });

  it('a post error (post/profile mismatch) gives no files, stage post', () => {
    const g = golden('generic', 'mixed');
    const r = exportNc(
      g.project,
      { profile: g.context.profile, version: 1, verification: 'draft' },
      postConfig('mach3'),
    );
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('post');
    expect(r.files).toEqual([]);
    expect(r.postErrors.map((e) => e.code)).toContain('POST_MISMATCH');
  });
});
