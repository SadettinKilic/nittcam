/// <reference types="node" />
/**
 * Tester adversarial suite for the T019 gate (spec §6.5, §7.2): own mutations beyond the dev's
 * catalogue, boundary values, wrong-layout / wrong-sheet contexts, the export gate and the lint
 * boundary. A false PASS is the worst bug: every "must fail" case asserts `canDownload` false.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { exportNc } from '../export';
import { canDownload, checkGcode, checkGcodeFiles } from './check';
import { golden, postConfig, type GoldenInput, type PostId } from './check.testing';
import { buildScenario, CORNERS, fileList, type Scenario } from './scenario.testing';
import type { GcodeCheckFilesContext } from './types';

const POSTS: PostId[] = ['generic', 'mach3'];
const NL = '\r\n';
const lines = (g: GoldenInput) => g.text.split(NL);
const text = (l: string[]) => l.join(NL);

function run(g: GoldenInput, mutated: string, ctx = g.context) {
  const r = checkGcode(mutated, ctx);
  return {
    r,
    can: canDownload(r),
    codes: [...new Set(r.violations.map((v) => `${v.rule}/${v.code}`))],
  };
}
function mustFail(g: GoldenInput, mutated: string, expectCode?: RegExp, ctx = g.context) {
  if (ctx === g.context) expect(mutated).not.toBe(g.text);
  const x = run(g, mutated, ctx);
  expect(x.can, x.codes.join(',')).toBe(false);
  expect(x.r.ok).toBe(false);
  if (expectCode) expect(x.codes.join(','), x.codes.join(',')).toMatch(expectCode);
  return x;
}
function idx(l: string[], re: RegExp, from = 0): number {
  const i = l.findIndex((s, k) => k >= from && re.test(s));
  if (i < 0) throw new Error(`anchor ${String(re)}`);
  return i;
}

describe.each(POSTS)('adversarial mutations (%s)', (post) => {
  const g = golden(post, 'mixed');

  it('clean golden passes (control)', () => {
    expect(run(g, g.text).codes).toEqual([]);
  });

  it('rapid at safe Z over a clamp zone outside the table: envelope', () => {
    for (const bad of [
      'G0 X3200.000 Y268.000',
      'G0 X-50.000 Y268.000',
      'G0 X206.000 Y2300.000',
      'G0 X206.000 Y-5.000',
    ]) {
      const l = lines(g);
      l[idx(l, /^G0 X207/)] = bad;
      mustFail(g, text(l), /R6\/OUT_OF_ENVELOPE/);
    }
  });

  it('G1 at Z0.001 above the material with no spindle is blocked (R4)', () => {
    const l = lines(g);
    l.splice(idx(l, /^M3 S/), 0, 'G1 Z0.001 F1000', 'G0 Z20.000');
    const x = mustFail(g, text(l));
    console.log(`[${post}] G1 Z0.001 spindle off ->`, x.codes.join(' '));
    expect(x.codes.some((c) => c.startsWith('R4/'))).toBe(true);
  });

  it('plunge split into two G1 moves, the second at the cutting feed', () => {
    const l = lines(g);
    const i = idx(l, /^G1 Z-4\.625/);
    const first = (l[i] ?? '').replace(/Z-4\.625\d*/, post === 'mach3' ? 'Z-2.0000' : 'Z-2.000');
    const second = (l[i] ?? '').replace(/F1500/, 'F6000');
    l.splice(i, 1, first, second);
    mustFail(g, text(l), /R3\/PLUNGE_TOO_FAST|MODEL/);
  });

  it('duplicate program end in the middle, followed by moves', () => {
    for (const end of [['M5', 'M9', 'M30'], ['M30'], ['M2']]) {
      const l = lines(g);
      l.splice(idx(l, /^G0 Z2\./) + 2, 0, ...end);
      mustFail(g, text(l), /R7/);
    }
  });

  it('arc: same endpoints, opposite direction (major arc, large radius)', () => {
    const l = lines(g);
    const i = idx(l, /^G2 /);
    l[i] = (l[i] ?? '').replace('G2', 'G3');
    mustFail(g, text(l));
    // opposite direction and the other centre (reflected over the chord): a different circle
    const l2 = lines(g);
    const j = idx(l2, /^G3 X\S+ Y\S+ I\S+ J\S+/, 20);
    let px = NaN;
    let py = NaN;
    for (let k = 0; k < j; k++) {
      const mx = /X(-?[\d.]+)/.exec(l2[k] ?? '');
      const my = /Y(-?[\d.]+)/.exec(l2[k] ?? '');
      if (mx) px = Number(mx[1]);
      if (my) py = Number(my[1]);
    }
    const m = /G3 X(\S+) Y(\S+) I(\S+) J(\S+)/.exec(l2[j] ?? '');
    if (!m) throw new Error('arc anchor');
    const [ex, ey, ii, jj] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const cx = px + ii;
    const cy = py + jj;
    const f = (n: number) => n.toFixed(post === 'mach3' ? 4 : 3);
    l2[j] = `G2 X${m[1]} Y${m[2]} I${f(px + ex - cx - px)} J${f(py + ey - cy - py)}`;
    mustFail(g, text(l2));
  });

  it('F word on a separate line before the move (legal, same meaning): outcome recorded', () => {
    const l = lines(g);
    const i = idx(l, /^G1 Z-4\.625/);
    l.splice(i, 1, 'F1500', (l[i] ?? '').replace(/ F1500/, ''));
    const x = run(g, text(l));
    console.log(`[${post}] F on its own line ->`, x.can ? 'ALLOWED' : 'BLOCKED', x.codes.join(' '));
    // Allowed only when the read path is the model's (same meaning); never a silent difference.
    if (x.can) expect(x.r.summary.matchedOperations).toBe(g.toolpath.operations.length);
  });

  it('F on its own line with the WRONG value, or no F at all, is blocked', () => {
    const l = lines(g);
    const i = idx(l, /^G1 Z-4\.625/);
    const wrong = [...l];
    wrong.splice(i, 1, 'F6000', (l[i] ?? '').replace(/ F1500/, ''));
    mustFail(g, text(wrong));
    const none = [...l];
    none[i] = (l[i] ?? '').replace(/ F1500/, '');
    mustFail(g, text(none), /R5|MODEL/);
  });

  it('lowercase g-code (legal, same meaning): outcome recorded', () => {
    const body = lines(g).map((s) => (s.startsWith('(') ? s : s.toLowerCase()));
    const x = run(g, text(body));
    console.log(`[${post}] lowercase ->`, x.can ? 'ALLOWED' : 'BLOCKED', x.codes.join(' '));
    if (x.can) expect(x.r.summary.matchedOperations).toBe(g.toolpath.operations.length);
  });

  it('spaces removed (legal, same meaning): outcome recorded', () => {
    const body = lines(g).map((s) => (s.startsWith('(') ? s : s.replace(/ /g, '')));
    const x = run(g, text(body));
    console.log(`[${post}] no spaces ->`, x.can ? 'ALLOWED' : 'BLOCKED', x.codes.join(' '));
    if (x.can) expect(x.r.summary.matchedOperations).toBe(g.toolpath.operations.length);
  });

  it('header comment in the wrong line', () => {
    const l = lines(g);
    const h = l.shift() ?? '';
    const second = [...l];
    second.splice(1, 0, h);
    mustFail(g, text(second), /R10/);
    mustFail(g, text([...l, h]), /R10/);
    mustFail(g, text(['(PROJE: x)', h, ...l]), /R10/);
    mustFail(g, text(['(DOGRULANMADI)', ...l]), /R10/);
    mustFail(g, text(l), /R10/);
  });

  it('Z exactly at the target passes; target -0.001 fails', () => {
    const l = lines(g);
    const ks = l.map((s, k) => (/^G1 Z-18\.5/.test(s) ? k : -1)).filter((k) => k >= 0);
    const k0 = ks[0] ?? -1;
    expect(k0).toBeGreaterThan(0);
    expect(run(g, g.text).can).toBe(true); // exact target = the golden file
    const withZ = (z: string) => {
      const m = [...l];
      m[k0] = (m[k0] ?? '').replace(/Z-18\.5\d*/, z);
      return text(m);
    };
    mustFail(g, withZ(post === 'mach3' ? 'Z-18.5010' : 'Z-18.501'), /R6\/BELOW_SPOILBOARD/);
    mustFail(g, withZ('Z-18.5001'), /R6\/BELOW_SPOILBOARD/);
    mustFail(g, withZ('Z-18.5006'), /R6\/BELOW_SPOILBOARD/);
    // 0.5 mm shallow: the part would not be cut through
    mustFail(g, withZ('Z-18.000'));
    const shallow = run(g, withZ('Z-18.499'));
    console.log(
      `[${post}] Z-18.499 (0.001 shallow) ->`,
      shallow.can ? 'ALLOWED' : 'BLOCKED',
      shallow.codes.join(' '),
    );
  });

  it('XY envelope: exactly on the boundary passes, +0.0006 fails (half-unit tolerance)', () => {
    const ctx = { ...g.context, profile: structuredClone(g.context.profile) };
    const env = ctx.profile.workEnvelope.x; // front-left, X+ right, zero offset
    const l = lines(g);
    const i = idx(l, /^G0 X207/);
    const at = (v: string) => {
      const m = [...l];
      m[i] = `G0 X${v} Y268.000`;
      return text(m);
    };
    const env6 = (t: string) =>
      checkGcode(t, ctx).violations.filter((v) => v.rule === 'R6' && v.code === 'OUT_OF_ENVELOPE');
    expect(env6(at(env.toFixed(3))), 'exact boundary').toEqual([]);
    const half = post === 'mach3' ? 0.00004 : 0.0004; // half unit of the written decimals
    expect(env6(at((env + half).toFixed(5))), 'half unit').toEqual([]);
    expect(env6(at((env + 0.0006).toFixed(4))).length, '+0.0006').toBeGreaterThan(0);
    expect(env6(at((env + 0.0001).toFixed(4))).length, '+0.0001').toBe(post === 'mach3' ? 1 : 0);
    expect(env6(at((env + 0.001).toFixed(3))).length, '+0.001').toBeGreaterThan(0);
    expect(env6(at((-0.0006).toFixed(4))).length, '-0.0006').toBeGreaterThan(0);
    mustFail(g, at((env + 0.001).toFixed(3)), /R6\/OUT_OF_ENVELOPE/, ctx);
  });

  it('a correct program judged against another layout is blocked', () => {
    const other = golden(post, 'cabinet-doors');
    const third = golden(post, 'shelf-set');
    mustFail(g, g.text, undefined, other.context);
    mustFail(other, other.text, undefined, g.context);
    mustFail(g, g.text, undefined, third.context);
  });

  it('the layout expectation moved, a part missing or an extra part is blocked (LAYOUT)', () => {
    const lay = g.context.layout ?? [];
    expect(lay.length).toBeGreaterThan(1);
    mustFail(g, g.text, /LAYOUT/, {
      ...g.context,
      layout: lay.map((p) => ({ ...p, cx: p.cx + 10 })),
    });
    mustFail(g, g.text, /LAYOUT/, { ...g.context, layout: lay.slice(1) });
    mustFail(g, g.text, /LAYOUT/, {
      ...g.context,
      layout: [...lay, { partId: 'x', copy: 0, cx: 100, cy: 100 }],
    });
  });
});

const BASE = (
  post: PostId,
  corner: Scenario['corner'],
  zRef: Scenario['zRef'],
  away: boolean,
): Scenario => ({
  post,
  corner,
  away,
  zRef,
  offset: { x: 17.3, y: 9.7 },
  warmup: 5,
  safeZ: 20,
  clearance: 2,
  spoil: 0.5,
  thickness: 18,
  toolDia: 8,
  feed: 6000,
  plunge: 1500,
  stepDown: 4.625,
  lead: 'arc',
  plunge2: { type: 'straight' },
  direction: 'climb',
  tabs: false,
  twoTools: false,
  files: 'normal',
  arcs: true,
  sheet: { width: 2440, height: 1220 },
  parts: [
    { id: 'p0', w: 600.37, h: 300.19, r: 12.3, qty: 2 },
    { id: 'p1', w: 250.5, h: 400.25, r: 0, qty: 1 },
  ],
});

describe('every corner and both Z references: clean programs pass', () => {
  const cases = POSTS.flatMap((p) =>
    CORNERS.flatMap((c) =>
      (['table', 'materialTop'] as const).flatMap((z) =>
        [false, true].map((a) => [p, c, z, a] as const),
      ),
    ),
  );
  it.each(cases)('%s %s %s away=%s: 0 violations', (p, c, z, a) => {
    const b = buildScenario(BASE(p, c, z, a));
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.result.errors).toEqual([]);
    const r = checkGcodeFiles(fileList(b.result.files), b.context);
    expect(r.violations).toEqual([]);
    expect(canDownload(r)).toBe(true);
  });

  it('a file generated for one corner or Z reference is blocked under another', () => {
    for (const p of POSTS) {
      const b = buildScenario(BASE(p, 'frontLeft', 'materialTop', false));
      if (!b) throw new Error('scenario');
      const files = fileList(b.result.files);
      const swapped = structuredClone(b.context);
      swapped.profile.origin = {
        ...swapped.profile.origin,
        corner: 'backRight',
        xPositive: 'left',
        yPositive: 'front',
      };
      expect(canDownload(checkGcodeFiles(files, swapped)), `${p} corner`).toBe(false);
      const zref = structuredClone(b.context);
      zref.profile.zZero = { ...zref.profile.zZero, reference: 'table' };
      expect(canDownload(checkGcodeFiles(files, zref)), `${p} zref`).toBe(false);
    }
  });
});

describe('second sheet checked against the first sheet context', () => {
  const s: Scenario = {
    ...BASE('generic', 'frontLeft', 'materialTop', false),
    offset: { x: 0, y: 0 },
    sheet: { width: 800, height: 500 },
    parts: [
      { id: 'a', w: 700, h: 450, r: 0, qty: 1 },
      { id: 'b', w: 600, h: 300, r: 10, qty: 1 },
      { id: 'c', w: 700, h: 450, r: 0, qty: 1 },
    ],
  };
  it.each(POSTS)('%s: relabelled, swapped, missing or duplicated sheets are blocked', (post) => {
    const b = buildScenario({ ...s, post });
    if (!b) throw new Error('scenario');
    const files = fileList(b.result.files);
    const sheets = [...new Set(files.map((f) => f.sheet))].sort();
    expect(sheets.length).toBeGreaterThan(1);
    // sheets 0 and 1 hold identical parts (a, c), so swap with the last, different, sheet
    const [s0, s1] = [sheets[0] ?? 0, sheets[sheets.length - 1] ?? 1];
    expect(canDownload(checkGcodeFiles(files, b.context))).toBe(true);
    const swapped = files.map((f) => ({
      ...f,
      sheet: f.sheet === s0 ? s1 : f.sheet === s1 ? s0 : f.sheet,
    }));
    expect(canDownload(checkGcodeFiles(swapped, b.context)), 'swapped').toBe(false);
    const only = files.filter((f) => f.sheet === s1).map((f) => ({ ...f, sheet: s0 }));
    expect(canDownload(checkGcodeFiles(only, b.context)), 'sheet 2 file as sheet 1').toBe(false);
    expect(
      canDownload(
        checkGcodeFiles(
          files.filter((f) => f.sheet === s0),
          b.context,
        ),
      ),
    ).toBe(false);
    expect(canDownload(checkGcodeFiles([...files, ...files.slice(0, 1)], b.context)), 'dup').toBe(
      false,
    );
    expect(canDownload(checkGcodeFiles([], b.context)), 'empty').toBe(false);
    const wrongMap: GcodeCheckFilesContext = {
      ...b.context,
      layout: new Map([...(b.context.layout ?? [])].map(([k, v]) => [k === 0 ? 1 : 0, v])),
    };
    expect(canDownload(checkGcodeFiles(files, wrongMap)), 'layout map swapped').toBe(false);
  });
});

describe('exportNc gate (own cases)', () => {
  it.each(POSTS)('%s success path: every file re-checks clean, stage done', (post) => {
    const g = golden(post, 'shelf-set');
    const r = exportNc(
      g.project,
      { profile: g.context.profile, version: 1, verification: 'draft' },
      postConfig(post),
    );
    expect(r.stage).toBe('done');
    expect(r.ok).toBe(true);
    expect(r.files.length).toBeGreaterThan(0);
    const again = checkGcodeFiles(fileList(r.files), {
      ...g.context,
      layout: new Map([[0, g.context.layout ?? []]]),
    });
    expect(again.violations).toEqual([]);
    expect(canDownload(again)).toBe(true);
  });

  it('an unverified profile whose post header was stripped never exports (R10)', () => {
    const g = golden('generic', 'mixed');
    const cfg = postConfig('generic');
    const r = exportNc(
      g.project,
      { profile: g.context.profile, version: 1, verification: 'draft' },
      cfg,
    );
    expect(r.files[0]?.content.split(NL)[0]).toMatch(/DOGRULANMADI/);
  });

  it('a toolpath stage failure and a post stage failure return no files and the stage', () => {
    const g = golden('mach3', 'mixed');
    const bad = structuredClone(g.context.profile);
    bad.materials = [];
    const t = exportNc(
      g.project,
      { profile: bad, version: 1, verification: 'draft' },
      postConfig('mach3'),
    );
    expect([t.ok, t.stage, t.files.length]).toEqual([false, 'toolpath', 0]);
    const p = exportNc(
      g.project,
      { profile: g.context.profile, version: 1, verification: 'draft' },
      postConfig('generic'),
    );
    expect([p.ok, p.stage, p.files.length]).toEqual([false, 'post', 0]);
    const junk = exportNc(
      g.project,
      { profile: g.context.profile, version: 1, verification: 'draft' },
      { nonsense: true },
    );
    expect(junk.ok).toBe(false);
    expect(junk.files).toEqual([]);
  });
});

describe('lint boundary (own probes)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const ROOT = resolve(HERE, '../../../..');
  const eslint = new ESLint({ cwd: ROOT });
  const lint = async (code: string, path = join(HERE, 'probe_t.ts')) =>
    (await eslint.lintText(code, { filePath: path }))[0]?.messages.map((m) => m.ruleId) ?? [];

  it('post and barrel imports, require and dynamic import are rejected in check code', async () => {
    const imports = [
      `import { a } from '../post';`,
      `import { a } from './../post/format';`,
      `import { a } from '../post/format.ts';`,
      `import { a } from '../toolpath/../post/format';`,
      `import type { a } from '../post';`,
      `export { a } from '../post';`,
      `export * from '../post/generate';`,
      `import { a } from '..';`,
      `import { a } from '../';`,
      `import { a } from '../index';`,
      `import { a } from '../index.ts';`,
      `import { a } from '@nittcam/core';`,
      `import { a } from '../../../core/src/post/format';`,
    ];
    const bad: string[] = [];
    for (const i of imports) {
      const m = await lint(`${i}\nexport const y = 1;\n`);
      if (!m.includes('no-restricted-imports')) bad.push(`${i} -> ${m.join(',') || 'NOT BLOCKED'}`);
    }
    const syntax = [
      `export const m = import('../post/format');`,
      `const r = require('../post/format'); export { r };`,
      `import { createRequire } from 'node:module'; export const q = createRequire(import.meta.url);`,
      `import x = require('../post'); export { x };`,
      `export type T = typeof import('../post');`,
      'export const m = import(`../po${"st"}`);',
    ];
    for (const i of syntax) {
      const m = await lint(`${i}\n`);
      if (!m.some((x) => x === 'no-restricted-syntax' || x === 'no-restricted-imports'))
        bad.push(`${i} -> ${m.join(',') || 'NOT BLOCKED'}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('only *.test.ts / *.testing.ts are exempt, not look-alike names', async () => {
    const code = `import { a } from '../post';\nexport const y = a;\n`;
    expect(await lint(code, join(HERE, 'x.testing.ts'))).toEqual([]);
    expect(await lint(code, join(HERE, 'x.ts'))).toContain('no-restricted-imports');
    expect(await lint(code, join(HERE, 'testing.ts'))).toContain('no-restricted-imports');
    expect(await lint(code, join(HERE, 'x.testing.tsx'))).toContain('no-restricted-imports');
  }, 60_000);

  it('no production file imports a *.testing.ts file (the exemption stays safe)', () => {
    type Ent = { name: string; isDirectory(): boolean };
    const walk = (d: string): string[] => {
      let ents: Ent[] = [];
      try {
        ents = readdirSync(d, { withFileTypes: true });
      } catch {
        return [];
      }
      return ents.flatMap((e) =>
        e.isDirectory()
          ? ['node_modules', '.next'].includes(e.name)
            ? []
            : walk(join(d, e.name))
          : [join(d, e.name)],
      );
    };
    const all = [
      ...walk(join(ROOT, 'packages')),
      ...walk(join(ROOT, 'apps')),
      ...walk(join(ROOT, 'tools')),
    ];
    const offenders = all
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      // dev-only scripts run through vitest configs (bench, golden:update); never imported by the app
      .filter((f) => !/\.(test|testing|bench|golden)\.(ts|tsx)$/.test(f))
      .filter((f) =>
        /from\s+['"][^'"]*\.testing(\.[jt]s)?['"]|import\(['"][^'"]*\.testing/.test(
          readFileSync(f, 'utf8'),
        ),
      );
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([]);
  });
});
