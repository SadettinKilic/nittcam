import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode } from './check';
import { goldenTray } from './check.testing';
import { vGrooveCheckOf } from '../export/export';
import { vGrooveTrayProject } from '../post/golden.testing';

// T354 (§7.2 rule 17): V-grooves against the read program.

const r17 = (text: string, ctx: ReturnType<typeof goldenTray>['context']) =>
  checkGcode(text, ctx)
    .violations.filter((v) => v.rule === 'R17')
    .map((v) => v.code);

describe('checker rule 17 (T354)', () => {
  it('the tray golden passes; the floor comes from the context, not from the toolpath', () => {
    const g = goldenTray('generic');
    expect(r17(g.text, g.context)).toEqual([]);
    // a stricter traits minimum (1,0 mm) makes the same program too deep: 3,2 > 4 − 1,0
    expect(r17(g.text, { ...g.context, vGroove: { minRemaining: 1 } })).toEqual([
      'VGROOVE_TOO_DEEP',
    ]);
  });

  it('a hand-deepened groove is refused for download', () => {
    const g = goldenTray('mach3');
    // T423: the final pass ramps in; its last leg ends at the groove depth
    const text = g.text.replace(/Z-3\.2000/, 'Z-3.6000');
    expect(text).not.toBe(g.text);
    const r = checkGcode(text, g.context);
    expect(r.violations.map((v) => v.code)).toContain('VGROOVE_TOO_DEEP');
    expect(canDownload(r)).toBe(false);
  });

  it('is silent without traits.vGroove in the context (wood jobs)', () => {
    const g = goldenTray('generic');
    const ctx = { ...g.context };
    delete ctx.vGroove;
    const deep = g.text.replace(/Z-3\.200/, 'Z-3.600');
    expect(r17(deep, ctx)).toEqual([]);
  });

  it('exportNc gives the checker the traits minimum only for ACM', () => {
    const p = vGrooveTrayProject(8);
    expect(vGrooveCheckOf(p)).toEqual({ vGroove: { minRemaining: 0.7 } });
    expect(vGrooveCheckOf({ ...p, stock: { ...p.stock, material: 'mdf' } })).toEqual({});
  });
});
