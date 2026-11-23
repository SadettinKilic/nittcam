/**
 * B62 fix round 1: the checker fails closed on a post without a T word (Mach3, manual change),
 * and the machine's own material set can no longer lift the feed ceiling (D-121 amended).
 */
import { describe, expect, it } from 'vitest';
import {
  defaultMachineProfile,
  exampleMachineProfile,
  materialFeedIssues,
  parseMachineProfileForSave,
} from '../machine';
import { validateProject } from '../validate';
import { canDownload, checkGcode } from './check';
import { golden } from './check.testing';

const codes = (r: ReturnType<typeof checkGcode>) => r.violations.map((v) => v.code);

describe('blocker 1: the active tool on Mach3 (no T word) comes from the job', () => {
  it('a hand-edited Mach3 cutting move past the sheet edge is CUTTER_OFF_SHEET', () => {
    const g = golden('mach3', 'cabinet-doors');
    const lines = g.text.split('\r\n');
    const i = lines.indexOf('G1 X10.0000');
    expect(i).toBeGreaterThan(0);
    lines[i] = 'G1 X2.0000';
    const r = checkGcode(lines.join('\r\n'), g.context);
    expect(canDownload(r)).toBe(false);
    expect(codes(r)).toContain('CUTTER_OFF_SHEET');
    expect(codes(r)).not.toContain('TOOL_UNKNOWN');
  });

  it('the two-tool Mach3 program: the tool advances at the change pause', () => {
    const g = golden('mach3', 'holes-through');
    expect(checkGcode(g.text, g.context).violations).toEqual([]);
  });

  it('a removed tool-change pause: the tool is unknown → TOOL_UNKNOWN, never skipped', () => {
    const g = golden('mach3', 'holes-through');
    const lines = g.text.split('\r\n');
    const last = lines.lastIndexOf('M0');
    lines.splice(last, 1);
    const r = checkGcode(lines.join('\r\n'), g.context);
    expect(canDownload(r)).toBe(false);
    expect(codes(r)).toContain('TOOL_UNKNOWN');
  });
});

describe('blocker 2: a typo in the machine’s own material set', () => {
  const g = golden('mach3', 'cabinet-doors');
  const typo = structuredClone(g.context.profile);
  for (const m of typo.materials) {
    m.feed = 59_000;
    m.plungeFeed = 29_000;
  }

  it('machine form: the save refuses the set with the feed keys', () => {
    const r = parseMachineProfileForSave(typo);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const keys = r.issues.map((i) => i.key);
    expect(keys).toContain('feedAboveMachineMax');
    expect(keys).toContain('plungeAboveMachineMax');
    // the seeded defaults (6000 / 1500 on rapid 10 000) still save
    expect(parseMachineProfileForSave(g.context.profile).ok).toBe(true);
  });

  it('the seeded default and example profiles keep every set under the strict ceiling', () => {
    expect(materialFeedIssues(defaultMachineProfile())).toEqual([]);
    expect(materialFeedIssues(exampleMachineProfile())).toEqual([]);
  });

  it('export: the validation blocks it with MACHINE_FEED_ABOVE_MAX', () => {
    const issues = validateProject(g.project, { machine: typo });
    expect(
      issues.filter((i) => i.code === 'MACHINE_FEED_ABOVE_MAX' && i.severity === 'error'),
    ).not.toEqual([]);
    expect(
      validateProject(g.project, { machine: g.context.profile }).map((i) => i.code),
    ).not.toContain('MACHINE_FEED_ABOVE_MAX');
  });

  it('checker: a file at F59000 is refused even when the profile set says 59 000', () => {
    const text = g.text.replace(/F6000\b/g, 'F59000');
    const r = checkGcode(text, { ...g.context, profile: typo });
    expect(canDownload(r)).toBe(false);
    expect(codes(r)).toContain('FEED_ABOVE_MACHINE');
  });
});
