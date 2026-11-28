import { describe, expect, it } from 'vitest';
import { vGrooveTrayProject } from '../post/golden.testing';
import type { Project } from '../schema';
import { validateProject } from '.';

// B70 round 2: the INNER_CONTOUR_INVALID skip is for V-groove rings only.
const v = (x: number, y: number) => ({ x, y, bulge: 0 });
const ring = [v(25, 25), v(25, 225), v(225, 225), v(225, 25)];

function withInner(kind: 'vgroove' | 'cut'): string[] {
  const p = vGrooveTrayProject(8);
  const part = p.parts[0];
  if (!part) throw new Error('no tray');
  const tray = {
    ...part,
    lines: [],
    inners: [ring],
    ops: { inners: kind === 'vgroove' ? [{ kind: 'vgroove' as const }] : [] },
  };
  return validateProject({ ...p, parts: [tray] } as Project, {}).map((i) => i.code);
}

describe('closed inner touching the outline (B70)', () => {
  it('a normal cut-out touching the outline is still refused', () => {
    expect(withInner('cut')).toContain('INNER_CONTOUR_INVALID');
  });
  it('the same ring as a V-groove is not', () => {
    expect(withInner('vgroove')).not.toContain('INNER_CONTOUR_INVALID');
  });
});
