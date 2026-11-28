import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode } from './check';
import { goldenBackFace, goldenTray } from './check.testing';
import { plungeCheckOf } from '../export/export';
import { vGrooveTrayProject } from '../post/golden.testing';

const r12 = (text: string, ctx: Parameters<typeof checkGcode>[1]) =>
  checkGcode(text, ctx).violations.filter((v) => v.rule === 'R12');

describe('checker rule 12: no straight plunge into ACM (T423)', () => {
  it('the ACM goldens pass (groove entries and tab ends ramp)', () => {
    for (const g of [goldenTray('mach3'), goldenTray('generic'), goldenBackFace('mach3')]) {
      expect(r12(g.text, g.context), g.file).toEqual([]);
    }
  });

  it('a straight plunge at a groove entry is refused for download', () => {
    const g = goldenTray('mach3');
    const text = g.text.replace('G1 Z0.0000 F300', 'G1 Z-1.6000 F300');
    expect(text).not.toBe(g.text);
    const r = checkGcode(text, g.context);
    expect(r.violations.find((v) => v.rule === 'R12')?.code).toBe('STRAIGHT_PLUNGE_IN_METAL');
    expect(canDownload(r)).toBe(false);
  });

  it('a ramp steeper than the limit (6° > 5°) is refused, one at 4,9° passes', () => {
    const g = goldenTray('mach3');
    // first leg 0 → −0,8 over 22,909 mm (2°); shorten the leg to tan⁻¹(0,8 / L)
    const leg = (deg: number) => (37 + 0.8 / Math.tan((deg * Math.PI) / 180)).toFixed(4);
    const steep = g.text.replace('G1 Y59.9090 Z-0.8000', `G1 Y${leg(6)} Z-0.8000`);
    expect(r12(steep, g.context).map((v) => v.code)).toContain('STRAIGHT_PLUNGE_IN_METAL');
    const ok = g.text.replace('G1 Y59.9090 Z-0.8000', `G1 Y${leg(4.9)} Z-0.8000`);
    expect(r12(ok, g.context)).toEqual([]);
  });

  it('a drill is excepted (rule 12 allows pecking with a drill)', () => {
    const g = goldenTray('mach3');
    const text = g.text.replace('G1 Z0.0000 F300', 'G1 Z-1.6000 F300');
    const profile = structuredClone(g.context.profile);
    const t7 = profile.tools.find((t) => t.number === 7);
    if (!t7) throw new Error('no T7');
    t7.type = 'drill';
    expect(r12(text, { ...g.context, profile })).toEqual([]);
  });

  it('is silent without the context (wood, plastic); exportNc turns it on only for ACM', () => {
    const g = goldenTray('mach3');
    const text = g.text.replace('G1 Z0.0000 F300', 'G1 Z-1.6000 F300');
    const ctx = { ...g.context };
    delete ctx.noStraightPlunge;
    expect(r12(text, ctx)).toEqual([]);
    const p = vGrooveTrayProject(8);
    expect(plungeCheckOf(p)).toEqual({ noStraightPlunge: { maxDeg: 5 } });
    expect(plungeCheckOf({ ...p, stock: { ...p.stock, material: 'mdf' } })).toEqual({});
    expect(plungeCheckOf({ ...p, stock: { ...p.stock, material: 'acrylic' } })).toEqual({});
  });
});
