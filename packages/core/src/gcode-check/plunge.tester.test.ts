/**
 * Tester checks for B73 / PR #246 (T423, rule 12 STRAIGHT_PLUNGE_IN_METAL): hand-edited ACM NC
 * files must be refused, the originals pass, wood keeps its straight plunges; small ACM parts are
 * never silently unheld; the test-cut program on an ACM set has no straight plunge either.
 */
import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode } from './check';
import { golden, goldenBackFace, goldenTray, postConfig } from './check.testing';
import { exportNc } from '../export/export';
import { traitsOf } from '../machine/material-traits';
import { nestProject } from '../nesting';
import { backFaceProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { testProgram } from '../testcut/program';

const r12 = (text: string, ctx: Parameters<typeof checkGcode>[1]) =>
  checkGcode(text, ctx).violations.filter((v) => v.rule === 'R12');

function edit(raw: string, from: string, to: string): string {
  const text = raw.replace(/\r\n/g, '\n');
  expect(text.includes(from), `missing: ${from}`).toBe(true);
  return text.replace(from, to);
}

/** Independent scan: feed moves going below Z0 steeper than `maxDeg` (no checker code). */
function steepDescents(text: string, maxDeg = 5): string[] {
  let x = 0;
  let y = 0;
  let z = 50;
  let motion = 0;
  const bad: string[] = [];
  const tan = Math.tan((maxDeg * Math.PI) / 180);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\(.*?\)/g, '').trim();
    if (!line) continue;
    const g = /\bG0?([0123])\b/.exec(line);
    if (g) motion = Number(g[1]);
    const v = (k: string) => {
      const m = new RegExp(`${k}(-?[0-9.]+)`).exec(line);
      return m ? Number(m[1]) : null;
    };
    const nx = v('X') ?? x;
    const ny = v('Y') ?? y;
    const nz = v('Z') ?? z;
    if (motion === 1 && nz < Math.min(z, 0) - 0.01) {
      const drop = Math.min(z, 0) - nz;
      const xy = (Math.hypot(nx - x, ny - y) * drop) / (z - nz);
      if (drop > tan * xy + 0.01) bad.push(raw);
    }
    x = nx;
    y = ny;
    z = nz;
  }
  return bad;
}

describe('B73 tester: rule 12 hand edits (mach3 + generic)', () => {
  it('originals pass, incl. the generic back face', () => {
    for (const g of [
      goldenTray('mach3'),
      goldenTray('generic'),
      goldenBackFace('mach3'),
      goldenBackFace('generic'),
    ]) {
      const r = checkGcode(g.text, g.context);
      expect(r.violations, g.file).toEqual([]);
      expect(steepDescents(g.text), g.file).toEqual([]);
    }
  });

  it('a deleted groove ramp leg (vertical to Z-1,6) is refused', () => {
    const g = goldenTray('mach3');
    const t = edit(g.text, 'G1 Y59.9090 Z-0.8000 F300\n', '');
    const r = checkGcode(t, g.context);
    expect(r.violations.some((v) => v.code === 'STRAIGHT_PLUNGE_IN_METAL')).toBe(true);
    expect(canDownload(r)).toBe(false);
  });

  it('a straight entry on the second groove pass is refused', () => {
    const g = goldenTray('mach3');
    const t = edit(
      g.text,
      'G1 Y214.0910 Z-2.4000 F300\nG1 Y237.0000 Z-3.2000\n',
      'G1 Z-3.2000 F300\n',
    );
    expect(r12(t, g.context).length).toBeGreaterThan(0);
  });

  it('a steeper groove ramp leg (10°) is refused; generic post too', () => {
    const g = goldenTray('generic');
    const leg = (37 + 0.8 / Math.tan((10 * Math.PI) / 180)).toFixed(3);
    const t = edit(g.text, 'G1 Y59.909 Z-0.800 F300', `G1 Y${leg} Z-0.800 F300`);
    expect(r12(t, g.context).length).toBeGreaterThan(0);
  });

  it('a straight plunge after a tab (main form) is refused', () => {
    const g = goldenBackFace('mach3');
    const t = edit(
      g.text,
      'G1 X677.7188 Z-3.7500 F1500\nG1 X656.2416 Z-4.5000\n',
      'G1 Z-4.5000 F1500\n',
    );
    const r = checkGcode(t, g.context);
    expect(r.violations.map((v) => v.code)).toContain('STRAIGHT_PLUNGE_IN_METAL');
    expect(canDownload(r)).toBe(false);
  });

  it('a deleted forward tab ramp leg is refused', () => {
    const g = goldenBackFace('mach3');
    const t = edit(g.text, 'G1 X677.7188 Z-3.7500 F1500\n', '');
    expect(r12(t, g.context).length).toBeGreaterThan(0);
  });

  it('a steeper tab ramp leg (8°) is refused', () => {
    const g = goldenBackFace('mach3');
    const leg = (656.2416 + 0.75 / Math.tan((8 * Math.PI) / 180)).toFixed(4);
    const t = edit(g.text, 'G1 X677.7188 Z-3.7500 F1500', `G1 X${leg} Z-3.7500 F1500`);
    expect(r12(t, g.context).length).toBeGreaterThan(0);
  });

  it('a small vertical step hidden before a valid ramp is refused', () => {
    const g = goldenTray('mach3');
    const t = edit(g.text, 'G1 Z0.0000 F300\n', 'G1 Z-0.3000 F300\n');
    expect(r12(t, g.context).length).toBeGreaterThan(0);
  });

  it('wood golden with straight plunges stays allowed', () => {
    for (const id of ['arc-tabs', 'shelf-set']) {
      const g = golden('mach3', id);
      expect(steepDescents(g.text).length, id).toBeGreaterThan(0);
      expect(r12(g.text, g.context), id).toEqual([]);
    }
  });
});

function acmProject(rects: readonly { w: number; h: number; qty?: number }[]): Project {
  const parsed = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'golden', profileVersion: 1 },
    stock: {
      material: 'acm',
      thickness: 4,
      sheet: { width: 800, height: 500, grain: 0 },
      useOffcuts: false,
    },
    parts: rects.map((r, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      qty: r.qty ?? 1,
      grain: { mode: 'free', angle: 0 },
      kind: 'rect',
      params: { w: r.w, h: r.h, r: 0 },
      inners: [],
      holes: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      templates: [],
    })),
    nesting: { mode: 'minWaste', gap: 10, margin: 12 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: traitsOf('acm').cutDirection },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const nested = nestProject(parsed.project, { toolDiameter: 8 });
  return { ...parsed.project, layout: nested.layout };
}

/** Feed moves that rise while staying below the top (tab tops). */
function raisesInMaterial(text: string): number {
  let z = 50;
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^G1\b.*Z(-?[0-9.]+)/.exec(line);
    const g0 = /^G0\b.*Z(-?[0-9.]+)/.exec(line);
    const nz = m ? Number(m[1]) : g0 ? Number(g0[1]) : z;
    if (m && nz > z && nz < 0) n++;
    z = nz;
  }
  return n;
}

describe('B73 tester: small ACM parts are held or blocked/warned, never silently free', () => {
  const sizes = [
    { w: 20, h: 20 },
    { w: 30, h: 30 },
    { w: 40, h: 25 },
    { w: 50, h: 50 },
    { w: 60, h: 15 },
    { w: 80, h: 40 },
    { w: 120, h: 30 },
  ];
  for (const s of sizes) {
    it(`${s.w} × ${s.h}`, () => {
      const profile = backFaceProfile('mach3');
      const project = acmProject([s]);
      const r = exportNc(
        project,
        { profile, version: 1, verification: 'draft' },
        postConfig('mach3'),
      );
      const codes = r.toolpathIssues.map((i) => i.code);
      if (r.ok) {
        const text = r.files[0]?.content ?? '';
        expect(steepDescents(text)).toEqual([]);
        // full-depth pass leaves raised spans (tab tops) or a tab warning says why not
        const tabsInNc = raisesInMaterial(text);
        const warned = codes.some((c) => c.startsWith('TABS_'));
        expect(tabsInNc > 0 || warned, `${codes.join(',')}`).toBe(true);
      } else {
        // blocked: an error must name the reason
        expect(r.toolpathIssues.some((i) => i.severity === 'error') || r.stage !== 'toolpath').toBe(
          true,
        );
      }
    });
  }
});

describe('B73 tester: test cut on an ACM set', () => {
  // Tester B73 bug 1: testProgram → postAndCheck gets no `noStraightPlunge`, so the ACM test cut
  // plunges straight into the panel (pocket entries) and R12 never refuses it. Flip to `it` once
  // the test-cut path is refused (or ramps) for a material without a straight plunge.
  it.fails('has no straight plunge into the panel', () => {
    const profile = backFaceProfile('mach3');
    const idx = profile.materials.findIndex((m) => m.material === 'acm');
    const r = testProgram(
      'testCut',
      { profile, version: 1, verification: 'draft' },
      postConfig('mach3'),
      { materialIndex: idx },
    );
    if (!r.ok) return; // refused is safe
    if (process.env.B73_DUMP) console.log(r.files[0]?.content);
    expect(steepDescents(r.files[0]?.content ?? '')).toEqual([]);
  });
});
