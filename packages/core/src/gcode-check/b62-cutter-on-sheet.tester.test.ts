import { describe, expect, it } from 'vitest';
import { generateGcode } from '../post';
import { validateProject } from '../validate';
import { buildToolpath } from '../toolpath';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { postConfig, type PostId } from './check.testing';
import { GOLDEN_IDS, golden } from './check.testing';
import { canDownload, checkGcode, checkGcodeFiles } from './index';
import { fileList } from './scenario.testing';
import { expectedLayouts } from './layout';

// B62 tester (T331, field rehearsal B2): parts at every sheet edge and corner, Ø6 / Ø8, margins
// 4 / 8 / 10 / 14, arc and line leads, climb and conventional, both posts. The NC text is read
// here with a small independent reader (no product reader): below the material top (Z < 0, origin
// front-left, Z0 on the material top), every feed move keeps the whole cutter (centre ± r) on the
// sheet. A margin below the tool Ø must not reach a downloadable file (checker error).

const W = 1000;
const H = 800;
const PW = 150;
const PH = 100;
const EPS = 0.002; // post rounding

function placements(m: number) {
  const xs = [m, (W - PW) / 2, W - m - PW];
  const ys = [m, (H - PH) / 2, H - m - PH];
  const out: { partId: string; index: number; x: number; y: number; rot: number }[] = [];
  let i = 0;
  for (const x of xs)
    for (const y of ys) {
      if (x === xs[1] && y === ys[1]) continue;
      out.push({ partId: 'p', index: i++, x, y, rot: 0 });
    }
  return out;
}

/** Independent: centre points of every feed move below Z 0, arcs sampled every ~0.5 mm. */
function cutCentres(text: string): { x: number; y: number; line: number }[] {
  let x = 0;
  let y = 0;
  let z = 50;
  let mode = 0;
  const out: { x: number; y: number; line: number }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, n) => {
    const l = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '');
    if (/G53/.test(l)) return; // park in machine coordinates, always at safe Z
    const g = /G0*([0-3])(?![0-9])/.exec(l);
    if (g) mode = Number(g[1]);
    const v = (k: string) => {
      const m = new RegExp(`${k}(-?[0-9.]+)`).exec(l);
      return m ? Number(m[1]) : undefined;
    };
    const nx = v('X') ?? x;
    const ny = v('Y') ?? y;
    const nz = v('Z') ?? z;
    if (mode !== 0 && Math.min(z, nz) < 0) {
      if (mode === 1) {
        const steps = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / 0.5));
        for (let s = 0; s <= steps; s++)
          out.push({ x: x + ((nx - x) * s) / steps, y: y + ((ny - y) * s) / steps, line: n + 1 });
      } else {
        const cx = x + (v('I') ?? 0);
        const cy = y + (v('J') ?? 0);
        const r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx);
        let a1 = Math.atan2(ny - cy, nx - cx);
        if (mode === 3 && a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
        if (mode === 2 && a1 >= a0 - 1e-9) a0 += 2 * Math.PI;
        const steps = Math.max(4, Math.ceil((Math.abs(a1 - a0) * r) / 0.5));
        for (let s = 0; s <= steps; s++) {
          const a = a0 + ((a1 - a0) * s) / steps;
          out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), line: n + 1 });
        }
      }
    }
    x = nx;
    y = ny;
    z = nz;
  });
  return out;
}

const cases: [number, number, 'arc' | 'line', 'climb' | 'conventional', PostId][] = [];
for (const d of [6, 8])
  for (const m of [4, 8, 10, 14])
    for (const lead of ['arc', 'line'] as const)
      for (const dir of ['climb', 'conventional'] as const)
        for (const post of ['generic', 'mach3'] as const) cases.push([d, m, lead, dir, post]);

describe('B62 tester: the cutter stays on the sheet, read from the NC text', () => {
  it.each(cases)('Ø%d margin %d lead %s %s %s', (d, m, lead, dir, postId) => {
    const project = projectOf({
      parts: [{ id: 'p', w: PW, h: PH, qty: 8 }],
      sheet: { width: W, height: H },
      margin: m,
      gap: 4,
      leadIn: lead,
      direction: dir,
      placements: [placements(m)],
    });
    const profile = machineOf({ toolDiameter: d });
    // The posts write T.. M6: an automatic changer, as in the checker scenarios.
    profile.toolChanger = { type: 'auto', capacity: 8, lengthCompensation: false };
    profile.post = { id: postId, version: '1.0.0' };
    const issues = validateProject(project, { machine: profile }).map((i) => i.code);
    const tp = buildToolpath(project, profile);
    if (m < d) expect(issues).toContain('MARGIN_BELOW_TOOL_RADIUS');
    if (!tp.ok) {
      // Refused before any file: fine only for a margin below Ø.
      expect(m, JSON.stringify(tp.errors).slice(0, 300)).toBeLessThan(d);
      return;
    }
    const post = postConfig(postId);
    const res = generateGcode(tp.toolpath, { profile, version: 1, verification: 'draft' }, post, {
      projectName: 'Kenar',
      revision: 1,
      fileStem: 'kenar',
      stock: { material: 'mdf', thickness: 18, sheetWidth: W, sheetHeight: H },
    });
    if (!res.ok) {
      expect(m, JSON.stringify(res.errors).slice(0, 400)).toBeLessThan(d);
      return;
    }
    const r = d / 2;
    const off: string[] = [];
    let minEdge = Infinity;
    for (const f of res.files) {
      for (const p of cutCentres(f.content)) {
        const e = Math.min(p.x - r, p.y - r, W - p.x - r, H - p.y - r);
        minEdge = Math.min(minEdge, e);
        if (e < -EPS) off.push(`${f.name}:${p.line} ${p.x.toFixed(3)}/${p.y.toFixed(3)}`);
      }
    }
    const check = checkGcodeFiles(fileList(res.files), {
      profile,
      verification: 'draft',
      post,
      toolpath: tp.toolpath,
      stock: { thickness: 18, sheetWidth: W, sheetHeight: H },
      layout: expectedLayouts(project),
    });
    const errs = check.violations.filter((v) => v.severity === 'error').map((v) => v.code);
    if (m < d) {
      // Below Ø: the file must not be downloadable (it would be the dangerous one).
      expect(canDownload(check), `margin ${m} < Ø${d} downloadable; off=${off.length}`).toBe(false);
      expect(errs).toContain('CUTTER_OFF_SHEET');
    } else {
      expect(errs).toEqual([]);
      expect(canDownload(check)).toBe(true);
    }
    if (m >= d) {
      expect(off.slice(0, 3)).toEqual([]);
      expect(minEdge).toBeGreaterThan(-EPS);
    }
  });
});

describe('B62 tester: hand-edited NC, a move pushed off the sheet (both posts)', () => {
  for (const postId of ['generic', 'mach3'] as const) {
    it(`${postId}: a cutting move edited to X 2 is CUTTER_OFF_SHEET`, () => {
      const g = golden(postId, GOLDEN_IDS[0] as string);
      const lines = g.text.split('\n');
      const plunge = lines.findIndex((l) => /^(N\d+ )?G1 Z-[\d.]+/.test(l));
      const at = lines.findIndex((l, i) => i > plunge && /^(N\d+ )?G1 X[-\d.]+/.test(l));
      expect(at).toBeGreaterThan(plunge);
      const broken = [...lines];
      broken[at] = (broken[at] as string).replace(/X-?[\d.]+/, 'X2.0000');
      const codes = checkGcode(broken.join('\n'), g.context).violations.map((v) => v.code);
      expect(codes).toContain('CUTTER_OFF_SHEET');
    });
  }
});
