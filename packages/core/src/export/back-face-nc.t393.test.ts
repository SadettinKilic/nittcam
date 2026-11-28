/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkGcodeFiles } from '../gcode-check';
import { postConfig } from '../gcode-check/check.testing';
import {
  backFaceFixtureProject,
  backFaceGoldenCases,
  backFaceProfile,
} from '../post/golden.testing';
import { buildToolpath } from '../toolpath';
import { exportNc } from './export';

// T393 (CTO #14 M1): a back-face program says so in its header, and the independent checker
// refuses a back-face program without the line (and a front-face program with it).

const LINE = 'PLAKA ARKA YUZU USTTE: PARCALAR AYNALI';
const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');

function back(post: 'generic' | 'mach3' = 'mach3') {
  const profile = backFaceProfile(post);
  const project = backFaceFixtureProject(8);
  return { profile, project, version: { profile, version: 1, verification: 'draft' as const } };
}

describe('back-face NC header (T393)', () => {
  it('every file of a back-face export carries the line, after the material line', () => {
    for (const post of ['generic', 'mach3'] as const) {
      const { project, version } = back(post);
      const r = exportNc(project, version, postConfig(post));
      expect(r.postErrors).toEqual([]);
      expect(r.ok).toBe(true);
      for (const f of r.files) {
        const lines = f.content.split(/\r?\n/);
        const at = lines.findIndex((l) => l.includes(LINE));
        expect(at).toBeGreaterThan(-1);
        expect(lines[at - 1]).toContain('DOGRULANMAMIS MALZEME: ACM');
      }
    }
  });

  it('a front-face export has no line', () => {
    const { project, version } = back();
    const front = { ...project, stock: { ...project.stock, machinedFace: 'front' as const } };
    const r = exportNc(front, version, postConfig('mach3'));
    expect(r.ok).toBe(true);
    for (const f of r.files) expect(f.content).not.toContain('ARKA YUZU');
  });

  it('the new golden files are the back-face exports byte for byte (header and mirrored layout)', () => {
    for (const c of backFaceGoldenCases()) {
      expect(c.result.ok).toBe(true);
      const { project, version } = back(c.postId);
      const r = exportNc(project, version, postConfig(c.postId), {
        projectName: 'ACM arka yüz',
        revision: 1,
        fileStem: 'acm-back-face',
      });
      expect(r.files.map((f) => f.content)).toEqual(c.result.files.map((f) => f.content));
      for (const f of c.result.files) {
        const want = readFileSync(join(MACHINES, c.dir, 'golden', f.name), 'utf8');
        expect(want).toContain(LINE);
      }
    }
  });
});

describe('checker: back-face header (T393)', () => {
  function context(face: 'front' | 'back' | undefined) {
    const { profile, project } = back();
    const tp = buildToolpath(project, profile);
    if (!tp.ok) throw new Error('toolpath');
    return {
      profile,
      verification: 'draft' as const,
      post: postConfig('mach3'),
      toolpath: tp.toolpath,
      stock: { thickness: 4, sheetWidth: 800, sheetHeight: 500 },
      ...(face ? { machinedFace: face } : {}),
    };
  }
  const files = () => {
    const { project, version } = back();
    const r = exportNc(project, version, postConfig('mach3'));
    expect(r.ok).toBe(true);
    return r.files;
  };
  const codes = (r: ReturnType<typeof checkGcodeFiles>) => r.violations.map((v) => v.code);

  it('accepts the generated back-face program', () => {
    const r = checkGcodeFiles(files(), context('back'));
    expect(codes(r)).not.toContain('BACK_FACE_HEADER_MISSING');
  });

  it('refuses a back-face program whose header line was removed', () => {
    const cut = files().map((f) => ({
      ...f,
      content: f.content
        .split('\r\n')
        .filter((l) => !l.includes('ARKA YUZU'))
        .join('\r\n'),
    }));
    const r = checkGcodeFiles(cut, context('back'));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('BACK_FACE_HEADER_MISSING');
  });

  it('does not accept the words after the first code line (header only)', () => {
    const moved = files().map((f) => {
      const lines = f.content.split('\r\n').filter((l) => !l.includes('ARKA YUZU'));
      const g = lines.findIndex((l) => l.startsWith('G21'));
      lines.splice(g + 1, 0, `(${LINE})`);
      return { ...f, content: lines.join('\r\n') };
    });
    expect(codes(checkGcodeFiles(moved, context('back')))).toContain('BACK_FACE_HEADER_MISSING');
  });

  it('refuses the line on a front-face project; no check when the face is not given', () => {
    const f = files();
    expect(codes(checkGcodeFiles(f, context('front')))).toContain('BACK_FACE_HEADER_UNEXPECTED');
    const none = codes(checkGcodeFiles(f, context(undefined)));
    expect(none).not.toContain('BACK_FACE_HEADER_UNEXPECTED');
    expect(none).not.toContain('BACK_FACE_HEADER_MISSING');
  });
});
