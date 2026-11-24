import { describe, expect, it } from 'vitest';
import { checkGcode } from './index';
import { GOLDEN_IDS, golden } from './check.testing';

// T331 (field rehearsal B2): the independent checker keeps the whole cutter on the sheet below
// the material top (R6 CUTTER_OFF_SHEET), judged on the read program with its own geometry.

const codes = (text: string, ctx: ReturnType<typeof golden>['context']) =>
  checkGcode(text, ctx).violations.map((v) => v.code);

describe('R6 CUTTER_OFF_SHEET (T331)', () => {
  it('no golden program has a cutter past the sheet edge', () => {
    for (const id of GOLDEN_IDS) {
      const g = golden('generic', id);
      expect(codes(g.text, g.context), id).not.toContain('CUTTER_OFF_SHEET');
    }
  });

  it('a cutting move whose centre is closer than the radius to the edge is rejected', () => {
    const g = golden('generic', GOLDEN_IDS[0] as string);
    const lines = g.text.split('\n');
    // The first G1 move in X/Y at depth (after a plunge): move its end to X 2 (Ø6 / Ø8 cutter
    // edge at −1 / −2), the field rehearsal's line.
    const plunge = lines.findIndex((l) => /^(N\d+ )?G1 Z-[\d.]+/.test(l));
    expect(plunge).toBeGreaterThan(0);
    const at = lines.findIndex((l, i) => i > plunge && /^(N\d+ )?G1 X[-\d.]+/.test(l));
    expect(at).toBeGreaterThan(plunge);
    const broken = [...lines];
    broken[at] = (broken[at] as string).replace(/X-?[\d.]+/, 'X2.0000');
    expect(codes(broken.join('\n'), g.context)).toContain('CUTTER_OFF_SHEET');
  });

  it('the same move far outside stays the older CUT_OUTSIDE_SHEET', () => {
    const g = golden('generic', GOLDEN_IDS[0] as string);
    const lines = g.text.split('\n');
    const plunge = lines.findIndex((l) => /^(N\d+ )?G1 Z-[\d.]+/.test(l));
    const at = lines.findIndex((l, i) => i > plunge && /^(N\d+ )?G1 X[-\d.]+/.test(l));
    const broken = [...lines];
    broken[at] = (broken[at] as string).replace(/X-?[\d.]+/, 'X-20.0000');
    const c = codes(broken.join('\n'), g.context);
    expect(c).toContain('CUT_OUTSIDE_SHEET');
    expect(c).not.toContain('CUTTER_OFF_SHEET');
  });
});
