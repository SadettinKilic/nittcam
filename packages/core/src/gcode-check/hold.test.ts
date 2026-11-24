/**
 * T338 (D-129): rule PART_NOT_HELD reads the material from the program text. A clean program
 * passes; a deleted tab climb and a neighbour's pass over a tab (the old, unfiltered output) fail.
 */
import { describe, expect, it } from 'vitest';
import { generateGcode } from '../post';
import { buildToolpath } from '../toolpath';
import { machineOf, projectOf } from '../toolpath/toolpath.testing';
import { checkGcode, checkGcodeFiles } from './check';
import { golden, postConfig } from './check.testing';
import { expectedLayouts } from './layout';
import type { GcodeCheckFilesContext } from './types';

const notHeld = (codes: readonly { code: string }[]) =>
  codes.filter((v) => v.code === 'PART_NOT_HELD');

describe('PART_NOT_HELD (T338, D-129)', () => {
  for (const post of ['generic', 'mach3'] as const) {
    it(`${post}: the small-rows golden passes; deleting a tab climb fails`, () => {
      const g = golden(post, 'small-rows');
      expect(notHeld(checkGcode(g.text, g.context).violations)).toEqual([]);
      const eol = g.text.includes('\r\n') ? '\r\n' : '\n';
      const lines = g.text.split(eol);
      // the first tab: the climb to the tab top after the deepest plunge
      const i = lines.findIndex((l) => /^G1 Z-15\.0+( F\d+)?$/.test(l));
      expect(i).toBeGreaterThan(0);
      const deep = lines
        .slice(0, i)
        .reverse()
        .find((l) => /^G1 Z-18\.5/.test(l));
      expect(deep).toBeDefined();
      lines[i] = deep as string;
      const v = notHeld(checkGcode(lines.join(eol), g.context).violations);
      expect(v.length).toBeGreaterThan(0);
      expect(v[0]).toMatchObject({ rule: 'LAYOUT', severity: 'error' });
    });
  }

  it("a neighbour's pass over a tab (holding rule off) fails; the toolpath refuses it itself", () => {
    // three rows at Ø + 0.1: the middle copy faces a neighbour on both long sides
    const W = 140;
    const H = 60 + 3 * 50 + 2 * 8.1;
    const project = projectOf({
      parts: [{ id: 'p', w: 80, h: 50, qty: 3 }],
      sheet: { width: W, height: H },
      margin: 30,
      placements: [
        [0, 1, 2].map((i) => ({ partId: 'p', index: i, x: 30, y: 30 + i * 58.1, rot: 0 })),
      ],
    });
    const profile = machineOf({ toolDiameter: 8 });
    // the generic post writes T.. M6: an automatic changer, as in the checker scenarios
    profile.toolChanger = { type: 'auto', capacity: 8, lengthCompensation: false };
    profile.post = { id: 'generic', version: '1.0.0' };
    const run = (tabHold: boolean) => {
      const tp = buildToolpath(project, profile, tabHold ? {} : { tabHold: false });
      const post = postConfig('generic');
      const res = generateGcode(tp.toolpath, { profile, version: 1, verification: 'draft' }, post, {
        projectName: 'Kopru',
        revision: 1,
        fileStem: 'kopru',
        stock: { material: 'mdf', thickness: 18, sheetWidth: W, sheetHeight: H },
      });
      const ctx: GcodeCheckFilesContext = {
        profile,
        verification: 'draft',
        post,
        toolpath: tp.toolpath,
        stock: { thickness: 18, sheetWidth: W, sheetHeight: H },
        layout: expectedLayouts(project, 8),
      };
      expect(res.files.length).toBeGreaterThan(0);
      return { tp, v: notHeld(checkGcodeFiles(res.files, ctx).violations) };
    };
    const old = run(false);
    // the unfiltered model claims tabs on the facing sides too
    expect(old.tp.toolpath.operations.every((o) => o.tabs.length >= 2)).toBe(true);
    expect(old.v.length).toBeGreaterThan(0);
    // with the rule the toolpath itself refuses the boxed-in middle copy (the safety net)
    const now = run(true);
    expect(now.tp.errors.map((e) => e.code)).toContain('SMALL_PART_NOT_HELD');
  });
});
