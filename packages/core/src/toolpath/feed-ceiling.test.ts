import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { checkGcode } from '../gcode-check';
import { GOLDEN_IDS, golden } from '../gcode-check/check.testing';
import {
  RAPID_FEED_FALLBACK,
  machineFeedLimits,
  parseMachineProfile,
  type MachineProfile,
} from '../machine';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { TOOLPATH_DEFAULTS, buildToolpath } from './build';
import { spindleSettingsOf } from './spindle';
import { clone, projectOf } from './toolpath.testing';

// T330 (D-121, field rehearsal B1): the feed ceiling comes from the machine; a feed far above the
// recommendation warns and needs a checklist tick.

const machine: MachineProfile = goldenProfile('generic'); // rapid 10 000, MDF 18: 6000 / 1500 → T2
const tool = machine.materials[0]?.tool ?? 2;

function project(): Project {
  const r = parseProject(
    clone(
      projectOf({
        parts: [{ id: 'a', w: 560, h: 720, qty: 1 }],
        placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
      }),
    ),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

/** The project with an own feed / plunge for the cutting tool, set without the command check. */
function withFeeds(feeds: { feed?: number; plungeFeed?: number }): Project {
  const p = clone(project()) as Project;
  (p.cutting as Record<string, unknown>).feeds = { [String(tool)]: feeds };
  return p;
}

describe('machineFeedLimits (T330)', () => {
  it('rapid rate for the feed, half of it for the plunge; own maximum wins', () => {
    expect(machine.rapidFeed).toBe(10_000);
    expect(machineFeedLimits(machine)).toEqual({
      feed: { min: 100, max: 10_000 },
      plungeFeed: { min: 50, max: 5_000 },
    });
    expect(machineFeedLimits({ ...machine, maxFeed: 8000, maxPlungeFeed: 2000 })).toEqual({
      feed: { min: 100, max: 8000 },
      plungeFeed: { min: 50, max: 2000 },
    });
  });

  it('without a rapid rate: the toolpath default, never the old 60 000', () => {
    expect(RAPID_FEED_FALLBACK).toBe(TOOLPATH_DEFAULTS.rapidFeed);
    const m = clone(machine) as MachineProfile;
    delete m.rapidFeed;
    expect(machineFeedLimits(m).feed.max).toBe(RAPID_FEED_FALLBACK);
  });

  it('B62 fix r1: the ceiling is strict; a set above a low rapid rate blocks, maxFeed lifts it', () => {
    const m = { ...machine, rapidFeed: 2000 };
    expect(machineFeedLimits(m).feed.max).toBe(2000);
    expect(machineFeedLimits(m).plungeFeed.max).toBe(1000);
    expect(
      validateProject(project(), { machine: m }).some(
        (i) => i.code === 'MACHINE_FEED_ABOVE_MAX' && i.severity === 'error',
      ),
    ).toBe(true);
    const own = { ...m, maxFeed: 6000, maxPlungeFeed: 1500 };
    expect(machineFeedLimits(own).feed.max).toBe(6000);
    expect(
      validateProject(project(), { machine: own }).some((i) => i.code === 'MACHINE_FEED_ABOVE_MAX'),
    ).toBe(false);
    expect(buildToolpath(project(), own).errors).toEqual([]);
  });

  it('the profile refuses a set above its own maximum', () => {
    const bad = parseMachineProfile({ ...clone(machine), maxFeed: 5000 });
    expect(bad.ok).toBe(false);
    const badPlunge = parseMachineProfile({ ...clone(machine), maxPlungeFeed: 1000 });
    expect(badPlunge.ok).toBe(false);
    expect(parseMachineProfile({ ...clone(machine), maxFeed: 6000, maxPlungeFeed: 1500 }).ok).toBe(
      true,
    );
  });
});

describe('the tester’s numbers: feed 59 000, plunge 29 000 on a rapid-10 000 machine', () => {
  it('the command refuses them', () => {
    const p = project();
    expect(applyCommand(p, 'setToolFeed', { tool, feed: 59_000 }, { machine }).ok).toBe(false);
    expect(applyCommand(p, 'setToolFeed', { tool, plungeFeed: 29_000 }, { machine }).ok).toBe(
      false,
    );
    expect(applyCommand(p, 'setToolFeed', { tool, plungeFeed: 15_000 }, { machine }).ok).toBe(
      false,
    );
  });

  it('validation and the toolpath report an error', () => {
    const p = withFeeds({ feed: 59_000, plungeFeed: 29_000 });
    const issues = validateProject(p, { machine }).filter((i) => i.code === 'FEED_OUT_OF_RANGE');
    expect(issues.map((i) => i.severity)).toEqual(['error', 'error']);
    expect(buildToolpath(p, machine).errors.map((e) => e.code)).toContain('FEED_OUT_OF_RANGE');
  });

  it('the checker rejects F59000 and a plunge at F29000 (R5 FEED_ABOVE_MACHINE)', () => {
    const g = golden('generic', GOLDEN_IDS[0] as string);
    const lines = g.text.split('\n');
    const cut = lines.findIndex((l) => /^(N\d+ )?G[123] .*F\d+/.test(l) && !/Z-/.test(l));
    const plunge = lines.findIndex((l) => /^(N\d+ )?G1 Z-[\d.]+ F\d+/.test(l));
    expect(cut).toBeGreaterThan(0);
    expect(plunge).toBeGreaterThan(0);
    const feedLines = [...lines];
    feedLines[cut] = (feedLines[cut] as string).replace(/F\d+(\.\d+)?/, 'F59000');
    const v1 = checkGcode(feedLines.join('\n'), g.context).violations;
    expect(v1.some((v) => v.code === 'FEED_ABOVE_MACHINE' && v.severity === 'error')).toBe(true);
    // 11 000 was fine under the old fixed 60 000 cap; the rapid-10 000 machine refuses it now.
    feedLines[cut] = (lines[cut] as string).replace(/F\d+(\.\d+)?/, 'F11000');
    const v2 = checkGcode(feedLines.join('\n'), g.context).violations.map((v) => v.code);
    expect(v2).toContain('FEED_ABOVE_MACHINE');
    const plungeLines = [...lines];
    plungeLines[plunge] = (plungeLines[plunge] as string).replace(/F\d+(\.\d+)?/, 'F29000');
    const v3 = checkGcode(plungeLines.join('\n'), g.context).violations.map((v) => v.code);
    expect(v3).toContain('FEED_ABOVE_MACHINE');
  });

  it('the golden programs (feeds at the recommendation) stay clean', () => {
    for (const id of GOLDEN_IDS) {
      const g = golden('generic', id);
      const errors = checkGcode(g.text, g.context).violations.filter(
        (v) => v.code === 'FEED_ABOVE_MACHINE',
      );
      expect(errors, id).toEqual([]);
    }
  });
});

describe('far above the recommendation: a warning, not an error', () => {
  const codes = (p: Project) =>
    validateProject(p, { machine })
      .filter((i) => i.code === 'FEED_ABOVE_RECOMMENDED')
      .map((i) => `${i.severity} ${i.path}`);

  it('at the recommendation or up to 1,5 ×: no warning', () => {
    expect(codes(project())).toEqual([]);
    expect(codes(withFeeds({ feed: 9000, plungeFeed: 2250 }))).toEqual([]);
  });

  it('feed 9100 (> 1,5 × 6000) and plunge 2300 (> 1,5 × 1500) warn', () => {
    expect(codes(withFeeds({ feed: 9100, plungeFeed: 2300 }))).toEqual([
      `warning cutting.feeds.${tool}.feed`,
      `warning cutting.feeds.${tool}.plungeFeed`,
    ]);
    const row = spindleSettingsOf(withFeeds({ feed: 9100 }), machine).find((r) => r.tool === tool);
    expect(row?.feedHigh).toBe(true);
    expect(row?.plungeHigh).toBe(false);
  });

  it('a chip load above 2 × the set’s (low rpm, same feed) warns', () => {
    const p = clone(project()) as Project;
    (p.cutting as Record<string, unknown>).spindleRpm = { [String(tool)]: 8000 };
    const row = spindleSettingsOf(p, machine).find((r) => r.tool === tool);
    expect(row?.chipLoadHigh).toBe(true);
    expect(codes(p)).toEqual([`warning cutting.feeds.${tool}.feed`]);
  });

  it('above the ceiling it is the error only, no extra warning', () => {
    expect(codes(withFeeds({ feed: 59_000 }))).toEqual([]);
  });
});
