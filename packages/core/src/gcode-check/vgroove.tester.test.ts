import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode } from './check';
import { goldenTray } from './check.testing';

// MB5 tester mutations (T354): each hand edit of the tray golden must be refused for download.
const codes = (text: string, g: ReturnType<typeof goldenTray>) => {
  const r = checkGcode(text, g.context);
  return { codes: r.violations.map((v) => v.code), ok: canDownload(r) };
};

describe.each(['generic', 'mach3'] as const)('R17 mutations (%s)', (post) => {
  const g = goldenTray(post);
  const deepZ = post === 'generic' ? 'G1 Z-3.200 F1500' : 'G1 Z-3.2000 F1500';
  const fmt = (n: number) => n.toFixed(post === 'generic' ? 3 : 4);

  it('baseline passes', () => {
    expect(codes(g.text, g)).toEqual({ codes: [], ok: true });
  });

  it('deepen one groove by 0.4 mm is refused', () => {
    const t = g.text.replace(deepZ, `G1 Z-${fmt(3.6)} F1500`);
    const r = codes(t, g);
    expect(r.codes).toContain('VGROOVE_TOO_DEEP');
    expect(r.ok).toBe(false);
  });

  it('dropping a whole groove is refused', () => {
    const lines = g.text.split('\n');
    const first = lines.findIndex((l) => l.includes('G1 Z-1.6'));
    // a groove block runs from the rapid to Z2 before the first plunge to the G0 Z20 after it
    const start = first - 2;
    const end = lines.findIndex((l, i) => i > first && l.startsWith('G0 Z20'));
    const t = [...lines.slice(0, start), ...lines.slice(end)].join('\n');
    const r = codes(t, g);
    expect(r.codes).toContain('VGROOVE_MISSING');
    expect(r.ok).toBe(false);
  });

  it('swapping the V-bit for the contour tool on a fold line is refused', () => {
    const t =
      post === 'generic'
        ? g.text.replace('T7 M6', 'T2 M6')
        : g.text.replace('(TAKIM T7 D12.000', '(TAKIM T2 D8.000').replace('M0\n', 'M0\nT2\n');
    expect(t).not.toBe(g.text);
    const r = codes(t, g);
    expect(r.ok).toBe(false);
  });
});

describe('V-groove on MDF (MB5 tester)', () => {
  it('no NC: validation error, toolpath refuses', async () => {
    const { vGrooveTrayProject, vGrooveProfile } = await import('../post/golden.testing');
    const { buildToolpath } = await import('../toolpath');
    const { validateProject } = await import('../validate');
    const p = vGrooveTrayProject(8);
    const mdf = { ...p, stock: { ...p.stock, material: 'mdf' } } as typeof p;
    expect(validateProject(mdf, {}).some((i) => i.code === 'VGROOVE_MATERIAL')).toBe(true);
    const tp = buildToolpath(mdf, vGrooveProfile('generic'));
    expect(tp.ok).toBe(false);
  });
});
