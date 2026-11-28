import { describe, expect, it } from 'vitest';
import { exportNc } from '../export/export';
import { vGrooveProfile, vGrooveTrayProject } from '../post/golden.testing';
import type { Project } from '../schema';
import { validateProject } from '../validate';
import { postConfig } from './check.testing';

// B70 tester repro: four V-kanal lines that meet at the relief corners arrive as ONE closed inner
// contour with the V-groove operation. The toolpath cuts it, rule 17 checks it like open lines.
const v = (x: number, y: number) => ({ x, y, bulge: 0 });

function closedTray(): Project {
  const p = vGrooveTrayProject(8);
  const part = p.parts[0];
  if (!part) throw new Error('no tray');
  const tray = {
    ...part,
    lines: [],
    inners: [[v(25, 25), v(25, 225), v(225, 225), v(225, 25)]],
    ops: { inners: [{ kind: 'vgroove' as const }] },
  };
  return { ...p, parts: [tray] } as Project;
}

// Feed moves in the plane (the groove passes run around the ring: 4 edges per pass).
const planeMoves = (text: string) =>
  text.split('\n').filter((l) => /^G1 [XY]/.test(l.trim())).length;

describe('closed V-groove contour (B70)', () => {
  it('validation: a fold ring along the relief corners is no invalid inner contour', () => {
    const codes = validateProject(closedTray(), {}).map((i) => i.code);
    expect(codes).not.toContain('INNER_CONTOUR_INVALID');
    expect(codes).not.toContain('VGROOVE_OUTSIDE_PART');
  });
  it('validation: a fold ring outside the part is refused', () => {
    const p = closedTray();
    const part = p.parts[0] as Project['parts'][number];
    const moved = { ...part, inners: [[v(25, 25), v(25, 300), v(225, 300), v(225, 25)]] };
    const codes = validateProject({ ...p, parts: [moved] } as Project, {}).map((i) => i.code);
    expect(codes).toContain('VGROOVE_OUTSIDE_PART');
  });

  for (const post of ['generic', 'mach3'] as const) {
    it(`${post}: exports, no rule 17 violation, the groove is cut`, () => {
      const r = exportNc(
        closedTray(),
        { profile: vGrooveProfile(post), version: 1, verification: 'draft' },
        postConfig(post),
      );
      expect(r.toolpathIssues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual(
        [],
      );
      expect(r.postErrors).toEqual([]);
      expect(
        (r.check?.violations ?? []).filter((x) => (x as { rule?: string }).rule === 'R17'),
      ).toEqual([]);
      expect(r.ok).toBe(true);
      const text = r.files.map((f) => f.content).join('\n');
      expect(text).toMatch(/Z-3\.2/);
      expect(planeMoves(text)).toBeGreaterThanOrEqual(8);
    });
  }
});
