/**
 * T311 (D-100): a manual tool change and the first-tool check must stop with M0. M1 is an optional
 * stop: with optional stop off on the controller the machine runs on with the old tool. The
 * independent check refuses M1 there; the post config only allows M0.
 */
import { describe, expect, it } from 'vitest';
import { parsePostConfig } from '../post';
import { config, metaFor, profileFor, run, sampleToolpath, SHEET } from '../post/post.testing';
import type { MachineProfile } from '../machine';
import type { Toolpath } from '../toolpath';
import { checkGcode, type GcodeCheckContext } from '.';

/** Mach3 (manual changer, first-tool check on) with T2 then T3: one real change. */
function twoTools(): { profile: MachineProfile; toolpath: Toolpath } {
  const profile = profileFor('mach3');
  profile.tools.push({ number: 3, type: 'flatEndMill', diameter: 6, fluteLength: 25, flutes: 2 });
  const toolpath = sampleToolpath(profile);
  const second = toolpath.operations[1];
  if (!second) throw new Error('sample toolpath needs two operations');
  second.tool = 3;
  second.toolDiameter = 6;
  return { profile, toolpath };
}

function program(): { text: string; ctx: GcodeCheckContext } {
  const { profile, toolpath } = twoTools();
  const r = run({ toolpath, profile, config: config('mach3') });
  expect(r.errors).toEqual([]);
  const ctx: GcodeCheckContext = {
    profile,
    verification: 'draft',
    post: config('mach3'),
    toolpath,
    stock: {
      thickness: metaFor().stock.thickness,
      sheetWidth: SHEET.width,
      sheetHeight: SHEET.height,
    },
    sheet: 0,
  };
  return { text: r.files[0]?.content ?? '', ctx };
}

const codes = (text: string, ctx: GcodeCheckContext) =>
  checkGcode(text, ctx)
    .violations.filter((v) => v.severity === 'error')
    .map((v) => v.code);

/** Replaces the n-th (0-based) `M0` line with `M1`. */
function toM1(text: string, n: number): string {
  let i = -1;
  return text
    .split('\r\n')
    .map((l) => (l === 'M0' && ++i === n ? 'M1' : l))
    .join('\r\n');
}

describe('manual tool change stops with M0 only (T311)', () => {
  it('the post writes M0 (never M1) for the first-tool check and every change', () => {
    const { text, ctx } = program();
    const lines = text.split('\r\n');
    expect(lines.filter((l) => l === 'M0').length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => /\bM0?1\b/.test(l))).toBe(false);
    expect(codes(text, ctx)).toEqual([]);
  });

  it('M1 at the first-tool check is refused', () => {
    const { text, ctx } = program();
    const m1 = toM1(text, 0);
    expect(m1).not.toBe(text);
    expect(codes(m1, ctx)).toContain('TOOL_CHANGE_OPTIONAL_STOP');
  });

  it('M1 at a tool change is refused', () => {
    const { text, ctx } = program();
    const m1 = toM1(text, 1);
    expect(m1).not.toBe(text);
    const found = checkGcode(m1, ctx).violations.find(
      (v) => v.code === 'TOOL_CHANGE_OPTIONAL_STOP',
    );
    expect(found?.severity).toBe('error');
    expect(found?.rule).toBe('TOOLS');
    expect(m1.split('\r\n')[(found?.line ?? 0) - 1]).toBe('M1');
  });

  it('M01 (same code, zero-padded) is refused too', () => {
    const { text, ctx } = program();
    const m01 = toM1(text, 1).replace('\r\nM1\r\n', '\r\nM01\r\n');
    expect(codes(m01, ctx)).toContain('TOOL_CHANGE_OPTIONAL_STOP');
  });

  it('the post config refuses manualStop M1', () => {
    const raw = structuredClone(config('mach3')) as unknown as {
      toolChange: { manualStop: string };
    };
    raw.toolChange.manualStop = 'M1';
    const r = parsePostConfig(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('toolChange.manualStop');
  });
});
