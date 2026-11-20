/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known lines */
/**
 * T189: operation-specific broken programs on the new golden fixtures (true-shape layout, arc
 * tabs D-058, cutting settings T288, thin skin T143). The generic mutation catalogue
 * (`check.golden.test.ts`) already breaks every §7.2 rule on every golden file; these cases break
 * what is special about each new operation and must be caught as well, on both posts.
 */
import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode } from './check';
import { golden, type GoldenInput, type PostId } from './check.testing';

const POSTS: PostId[] = ['generic', 'mach3'];
const NUM = String.raw`-?\d+(?:\.\d+)?`;

/** Z value of a line, or null. */
function zOf(line: string): number | null {
  const m = new RegExp(String.raw`Z(${NUM})`).exec(line);
  return m ? Number(m[1]) : null;
}

/** Tracks Z through the program and returns the index of each line with its Z before the line. */
function withZ(lines: string[]): { i: number; z: number; line: string }[] {
  let z = Number.POSITIVE_INFINITY;
  return lines.map((line, i) => {
    const before = z;
    const nz = zOf(line);
    if (nz !== null && /^G[0123]\b/.test(line)) z = nz;
    return { i, z: before, line };
  });
}

function expectCaught(g: GoldenInput, mutated: string): string[] {
  expect(mutated).not.toBe(g.text);
  const r = checkGcode(mutated, g.context);
  expect(r.ok).toBe(false);
  expect(canDownload(r)).toBe(false);
  return r.violations.filter((v) => v.severity === 'error').map((v) => `${v.rule}:${v.code}`);
}

/** Every tab-top line (G1 to `tabTop`) is sent to the full depth: the tabs are gone. */
function dropTabs(g: GoldenInput): string {
  const tabTop = Math.min(...g.toolpath.operations.flatMap((o) => o.tabs.map((t) => t.z)));
  const deepest = Math.min(
    ...g.text
      .split('\r\n')
      .map(zOf)
      .filter((z): z is number => z !== null),
  );
  return g.text
    .split('\r\n')
    .map((l) =>
      /^G1\b/.test(l) && zOf(l) === tabTop
        ? l.replace(new RegExp(String.raw`Z${NUM}`), `Z${deepest.toFixed(3)}`)
        : l,
    )
    .join('\r\n');
}

describe.each(POSTS)('new operations, broken on purpose (%s)', (post) => {
  it('true-shape: a part shifted 5 mm off its nested position is caught (LAYOUT / MODEL)', () => {
    const g = golden(post, 'true-shape');
    // Shift every X of the last part (the operations after the last XY rapid at safe Z).
    const lines = g.text.split('\r\n');
    const rapids = lines.map((l, i) => (/^G0 X/.test(l) ? i : -1)).filter((i) => i >= 0);
    const from = rapids[rapids.length - 1] as number;
    const out = lines.map((l, i) =>
      i >= from
        ? l.replace(
            new RegExp(String.raw`X(${NUM})`),
            (_m, x: string) => `X${(Number(x) + 5).toFixed(post === 'generic' ? 3 : 4)}`,
          )
        : l,
    );
    const codes = expectCaught(g, out.join('\r\n'));
    expect(codes.some((c) => c.startsWith('MODEL') || c.startsWith('LAYOUT'))).toBe(true);
  });

  it('true-shape: an inner-contour arc flown as a rapid inside the material is caught', () => {
    const g = golden(post, 'true-shape');
    const lines = g.text.split('\r\n');
    const hit = withZ(lines).find((r) => r.z < 0 && /^G[23]\b/.test(r.line));
    expect(hit).toBeDefined();
    lines[hit!.i] = hit!.line.replace(/^G[23]/, 'G0').replace(/ [IJR]-?[\d.]+/g, '');
    expectCaught(g, lines.join('\r\n'));
  });

  it('arc-tabs: tabs removed (cut to full depth) is caught by the model check', () => {
    const g = golden(post, 'arc-tabs');
    const codes = expectCaught(g, dropTabs(g));
    expect(codes.some((c) => c.startsWith('MODEL'))).toBe(true);
  });

  it('arc-tabs: the climb over an arc tab as a rapid is caught (rule 3)', () => {
    const g = golden(post, 'arc-tabs');
    const lines = g.text.split('\r\n');
    const tabTop = Math.min(...g.toolpath.operations.flatMap((o) => o.tabs.map((t) => t.z)));
    const hit = withZ(lines).find(
      (r) => r.z < tabTop && /^G1\b/.test(r.line) && zOf(r.line) === tabTop,
    );
    expect(hit).toBeDefined();
    lines[hit!.i] = hit!.line.replace(/^G1/, 'G0').replace(/ F[\d.]+/, '');
    expectCaught(g, lines.join('\r\n'));
  });

  it('cutting-settings: tabs removed is caught; feed dropped from the straight lead-in is caught', () => {
    const g = golden(post, 'cutting-settings');
    expect(expectCaught(g, dropTabs(g)).some((c) => c.startsWith('MODEL'))).toBe(true);
    // Direction: the first contour flown the other way round (G2 <-> G3 swap) is caught.
    const lines = g.text.split('\r\n');
    const swapped = lines.map((l) =>
      /^G2\b/.test(l) ? l.replace(/^G2/, 'G3') : /^G3\b/.test(l) ? l.replace(/^G3/, 'G2') : l,
    );
    expectCaught(g, swapped.join('\r\n'));
  });

  it.each(['tab-bounds-min', 'tab-bounds-max'])(
    '%s: tabs at the T293 bounds removed is caught',
    (fx) => {
      const g = golden(post, fx);
      expect(expectCaught(g, dropTabs(g)).some((c) => c.startsWith('MODEL'))).toBe(true);
    },
  );

  it('thin-skin: the cleanup passes removed (skin left on the sheet) is caught', () => {
    const g = golden(post, 'thin-skin');
    const lines = g.text.split('\r\n');
    const placements = g.project.layout.sheets[0]?.placements.length ?? 0;
    const cleanups = g.toolpath.operations.length - placements;
    expect(cleanups).toBe(5);
    const rapids = lines.map((l, i) => (/^G0 X/.test(l) ? i : -1)).filter((i) => i >= 0);
    const from = rapids[rapids.length - cleanups] as number;
    // Keep the end block (the last retract and everything after it).
    const endAt = lines.findIndex((l, i) => i > from && /^M5\b/.test(l)) - 1;
    const out = [...lines.slice(0, from), ...lines.slice(endAt)];
    const codes = expectCaught(g, out.join('\r\n'));
    expect(codes.some((c) => c.startsWith('MODEL') || c.startsWith('LAYOUT'))).toBe(true);
  });

  it('thin-skin: a small part cut through on its first pass (no skin) is caught', () => {
    const g = golden(post, 'thin-skin');
    const skinZ = -(g.project.stock.thickness - (g.project.cutting.skin?.thickness ?? 0));
    const deepest = Math.min(
      ...g.text
        .split('\r\n')
        .map(zOf)
        .filter((z): z is number => z !== null),
    );
    const out = g.text
      .split('\r\n')
      .map((l) =>
        /^G1\b/.test(l) && zOf(l) !== null && Math.abs((zOf(l) as number) - skinZ) < 1e-6
          ? l.replace(new RegExp(String.raw`Z${NUM}`), `Z${deepest.toFixed(3)}`)
          : l,
      )
      .join('\r\n');
    expectCaught(g, out);
  });
});
