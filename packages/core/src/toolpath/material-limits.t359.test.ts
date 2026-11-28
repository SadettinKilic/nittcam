import { describe, expect, it } from 'vitest';
import { buildToolpath } from './build';
import { chipLoadRefusal, chipLoadStatus, materialLimitFindings } from './material-limits';
import { spindleSettingsOf } from './spindle';
import { aluProfile, aluProject } from './alu.testing';
import { validateProject } from '../validate';
import { applyCommand } from '../commands';
import { vGrooveProfile, vGrooveTrayProject } from '../post/golden.testing';
import { chipLoadBand, traitsOf } from '../machine/material-traits';

const codes = (p: ReturnType<typeof aluProject>, m: ReturnType<typeof aluProfile>) =>
  materialLimitFindings(p, m).map((f) => `${f.code}:${f.severity}`);

describe('T359: step-down and chip-load limits', () => {
  it('in band and under the ceiling: nothing', () => {
    expect(codes(aluProject([]), aluProfile())).toEqual([]);
  });

  it('chip load exactly on both edges passes; just outside is an aluminium error with the fix', () => {
    // Ø6 2 flutes at 18 000 rpm: band 0,04–0,1 → feed 1440 … 3600
    expect(codes(aluProject([]), aluProfile({ feed: 3600 }))).toEqual([]);
    expect(codes(aluProject([]), aluProfile({ feed: 1440 }))).toEqual([]);
    const hi = materialLimitFindings(aluProject([]), aluProfile({ feed: 3610 }));
    expect(hi.map((f) => f.code)).toEqual(['CHIP_LOAD_OUT_OF_RANGE']);
    expect(hi[0]?.severity).toBe('error');
    expect(hi[0]?.message).toMatch(/0\.04–0\.1/);
    expect(hi[0]?.message).toMatch(/set the feed to 3600 mm\/min/);
    const lo = materialLimitFindings(aluProject([]), aluProfile({ feed: 1430 }));
    expect(lo[0]?.message).toMatch(/set the feed to 1440 mm\/min/);
  });

  it('step-down: 0,5 × Ø on a standard machine, 0,25 × Ø on a light one', () => {
    expect(codes(aluProject([]), aluProfile({ stepDown: 3 }))).toEqual([]);
    expect(codes(aluProject([]), aluProfile({ stepDown: 3.01 }))).toEqual([
      'STEP_DOWN_ABOVE_MATERIAL_LIMIT:error',
    ]);
    const light = aluProfile({ stepDown: 2 });
    light.metal = { enabled: true, rigidity: 'light' };
    const f = materialLimitFindings(aluProject([]), light);
    expect(f.map((x) => x.code)).toEqual(['STEP_DOWN_ABOVE_MATERIAL_LIMIT']);
    expect(f[0]?.message).toMatch(/allowed 0–1\.5 mm/);
  });

  it('a hole tool is judged with its own diameter and flutes; a drill is not', () => {
    const m = aluProfile();
    m.tools.push({ number: 4, type: 'flatEndMill', diameter: 2, fluteLength: 12, flutes: 1 });
    // T4 Ø2 1 flute at 1440 / 18000 = 0,08 > 0,02 (Ø < 3 band) → error; step-down 2 > 1 → error
    const p = aluProject([
      { id: 'h1', type: 'through', d: 4, cx: 60, cy: 60, tool: 4 },
      { id: 'h2', type: 'through', d: 5, cx: 120, cy: 60, tool: 3 },
    ]);
    const f = materialLimitFindings(p, m);
    expect(f.filter((x) => x.tool === 4).map((x) => x.code)).toEqual([
      'CHIP_LOAD_OUT_OF_RANGE',
      'STEP_DOWN_ABOVE_MATERIAL_LIMIT',
    ]);
    expect(f.some((x) => x.tool === 3)).toBe(false);
  });

  it('SLOT_TOO_DEEP warns above 3 × Ø, not at it', () => {
    const m = aluProfile();
    m.tools[0] = {
      ...m.tools[0],
      number: 1,
      type: 'flatEndMill',
      diameter: 2,
      fluteLength: 22,
      flutes: 1,
    } as never;
    // Ø2: 6 mm deep = 3 × Ø → silent on the slot (chip load / step-down aside)
    expect(codes(aluProject([]), m).filter((c) => c.startsWith('SLOT'))).toEqual([]);
    const p = aluProject([]);
    const deeper = { ...p, stock: { ...p.stock, thickness: 6.5 } };
    const m2 = aluProfile();
    m2.tools[0] = m.tools[0] as never;
    m2.materials = m2.materials.map((s) =>
      s.material === 'aluminium' ? { ...s, thickness: 6.5 } : s,
    );
    expect(materialLimitFindings(deeper, m2).map((f) => f.code)).toContain('SLOT_TOO_DEEP');
  });

  it('validation and toolpath report the same codes; an error stops the toolpath', () => {
    const p = aluProject([]);
    const m = aluProfile({ feed: 4000 });
    const v = validateProject(p, { machine: m }).filter((i) => i.code === 'CHIP_LOAD_OUT_OF_RANGE');
    expect(v.map((i) => i.severity)).toEqual(['error']);
    const r = buildToolpath(p, m);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('CHIP_LOAD_OUT_OF_RANGE');
  });

  it('ACM: a warn band (the toolpath still builds); the V-bit has its own band (≤ 0,05)', () => {
    const t = traitsOf('acm');
    expect(chipLoadBand(t, 12, 'vBit')).toEqual({ min: 0.02, max: 0.05, enforce: 'warn' });
    expect(chipLoadBand(t, 5, 'drill')).toBeNull();
    const p = vGrooveTrayProject(8);
    const m = vGrooveProfile('mach3');
    expect(materialLimitFindings(p, m)).toEqual([]);
    const v = spindleSettingsOf(p, m).find(
      (r) => m.tools.find((x) => x.number === r.tool)?.type === 'vBit',
    );
    expect(v).toBeTruthy();
    if (!v) return;
    const fast = { ...p, cutting: { ...p.cutting, feeds: { [String(v.tool)]: { feed: 6000 } } } };
    const f = materialLimitFindings(fast, m);
    expect(f.map((x) => `${x.code}:${x.severity}`)).toEqual(['CHIP_LOAD_OUT_OF_RANGE:warning']);
    expect(buildToolpath(fast, m).ok).toBe(true);
    expect(chipLoadStatus(fast, { ...v, chipLoad: 6000 / (v.rpm * v.flutes) }, m)?.fixFeed).toBe(
      Math.floor((0.05 * v.rpm * v.flutes) / 10) * 10,
    );
  });

  it('setToolFeed and setSpindleRpm refuse values that leave an aluminium band', () => {
    const p = aluProject([]);
    const m = aluProfile();
    expect(chipLoadRefusal(p, m, 1, { feed: 4000 })).toMatch(/set the feed to 3600 mm\/min/);
    expect(chipLoadRefusal(p, m, 1, { feed: 3000 })).toBeUndefined();
    expect(chipLoadRefusal(p, m, 1, { feed: null })).toBeUndefined();
    expect(chipLoadRefusal(p, m, 1, { rpm: 6000 })).toMatch(/outside 0\.04–0\.1/);
    const bad = applyCommand(p, 'setToolFeed', { tool: 1, feed: 4000 }, { machine: m });
    expect(bad.ok).toBe(false);
    const good = applyCommand(p, 'setToolFeed', { tool: 1, feed: 3000 }, { machine: m });
    expect(good.ok).toBe(true);
  });

  it('wood and plastic are untouched', () => {
    const p = aluProject([], {}, 'mdf');
    const m = aluProfile({ feed: 99000 });
    m.materials = m.materials.map((s) => ({ ...s, material: 'mdf' }));
    expect(materialLimitFindings(p, m)).toEqual([]);
  });
});
