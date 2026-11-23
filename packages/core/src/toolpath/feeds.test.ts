import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { checkGcode } from '../gcode-check';
import { GOLDEN_IDS, golden, postConfig } from '../gcode-check/check.testing';
import { machineFeedLimits, PROFILE_BOUNDS, type MachineProfile } from '../machine';
import { goldenProfile } from '../post/golden.testing';
import { feedHeaders } from '../post/generate';
import { generateGcode } from '../post';
import { FEED_BOUNDS, PLUNGE_FEED_BOUNDS, parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { recommendedFeeds } from './op-tools';
import { feedOverridesOf, spindleSettingsOf } from './spindle';
import { clone, projectOf } from './toolpath.testing';

// T323: cutting feed and plunge feed per tool, per project. Default = the tool's material set
// (goldens unchanged); an override is an undoable command, reaches the F words of that tool's
// operations and an "İLERLEME" header line, and never leaves the machine's limits (command,
// validation, toolpath, post, checker).

enablePatches();

/** Golden generic profile (T1 Ø6, T2 Ø8; MDF 18 set → T2) plus a thinner MDF set naming T1. */
function machineWithSets(): MachineProfile {
  const m = goldenProfile('generic');
  const base = m.materials[0];
  if (!base) throw new Error('no set');
  m.materials = [
    ...m.materials,
    { ...base, thickness: 12, rpm: 20000, tool: 1, feed: 4000, plungeFeed: 900 },
  ];
  return m;
}
const machine = machineWithSets();
const set = machine.materials[0] as MachineProfile['materials'][number];

/** One 300 × 200 part with a Ø6 through hole (T1) and a Ø35 pocket (T1). */
function project(): Project {
  const base = clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200, qty: 1 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: 0 }]],
    }),
  ) as Project;
  const part = base.parts[0];
  if (!part) throw new Error('no part');
  part.holes = [
    { type: 'through', id: 'h1', d: 6, cx: 50, cy: 50, tool: 1 },
    { type: 'pocket', id: 'p1', d: 35, cx: 150, cy: 100, tool: 1, depth: 12 },
  ];
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function run(p: Project, name: string, params: unknown): Project {
  const r = applyCommand(p, name, params, { machine });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(applyPatches(r.project, r.inversePatches)).toEqual(p);
  return r.project;
}

const feedsByTool = (p: Project) => {
  const r = buildToolpath(p, machine);
  expect(r.errors).toEqual([]);
  const out = new Map<number, Set<string>>();
  for (const o of r.toolpath.operations) {
    const s = out.get(o.tool) ?? new Set();
    s.add(`F${o.feed}/${o.plungeFeed}`);
    out.set(o.tool, s);
  }
  return out;
};

const exp = (p: Project): string => {
  const r = exportNc(
    p,
    { profile: machine, version: 1, verification: 'draft' },
    postConfig('generic'),
  );
  expect(r.ok, JSON.stringify(r.ok ? '' : r)).toBe(true);
  return r.ok ? (r.files[0]?.content ?? '') : '';
};

describe('feed limits and schema (T323)', () => {
  it('schema bounds equal the profile bounds; machine limits are those bounds', () => {
    expect(FEED_BOUNDS).toEqual(PROFILE_BOUNDS.feed);
    expect(PLUNGE_FEED_BOUNDS).toEqual(PROFILE_BOUNDS.plungeFeed);
    expect(machineFeedLimits()).toEqual({
      feed: PROFILE_BOUNDS.feed,
      plungeFeed: PROFILE_BOUNDS.plungeFeed,
    });
  });

  it('an old project (no feeds) parses and keeps the set feeds for every tool', () => {
    const p = project();
    expect(p.cutting.feeds).toBeUndefined();
    const rows = spindleSettingsOf(p, machine);
    expect(rows.map((r) => [r.tool, r.feed, r.plungeFeed, r.feedOverride])).toEqual([
      [1, set.feed, set.plungeFeed, false],
      [2, set.feed, set.plungeFeed, false],
    ]);
    expect(feedOverridesOf(p, machine)).toEqual([]);
  });

  it('the schema refuses feeds outside the profile-wide bounds and zero', () => {
    for (const bad of [
      { feed: 0 },
      { feed: -1 },
      { feed: 60_001 },
      { plungeFeed: 30_001 },
      { x: 1 },
    ]) {
      const p = clone(project()) as Project;
      (p.cutting as Record<string, unknown>).feeds = { '1': bad };
      expect(parseProject(p).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('setToolFeed (T323)', () => {
  it('sets, clears per field and undoes', () => {
    let p = run(project(), 'setToolFeed', { tool: 1, feed: 3000, plungeFeed: 800 });
    expect(p.cutting.feeds).toEqual({ '1': { feed: 3000, plungeFeed: 800 } });
    p = run(p, 'setToolFeed', { tool: 1, feed: null });
    expect(p.cutting.feeds).toEqual({ '1': { plungeFeed: 800 } });
    p = run(p, 'setToolFeed', { tool: 1, plungeFeed: null });
    expect(p.cutting.feeds).toBeUndefined();
  });

  it('refuses unknown tools, zero, values above the machine limit and empty params', () => {
    const p = project();
    for (const params of [
      { tool: 9, feed: 3000 },
      { tool: 1, feed: 0 },
      { tool: 1, feed: 70_000 },
      { tool: 1, plungeFeed: 40_000 },
      { tool: 1 },
    ]) {
      expect(applyCommand(p, 'setToolFeed', params, { machine }).ok, JSON.stringify(params)).toBe(
        false,
      );
    }
  });

  it('is a machine setting, not an AI tool', async () => {
    const { COMMANDS } = await import('../commands/registry');
    expect(COMMANDS.setToolFeed.aiTool).toBe(false);
  });
});

describe('toolpath and program follow the per-tool feeds (T323)', () => {
  it('default: every tool at the set feeds (as before)', () => {
    const f = feedsByTool(project());
    expect([...(f.get(1) ?? [])]).toEqual([`F${set.feed}/${set.plungeFeed}`]);
    expect([...(f.get(2) ?? [])]).toEqual([`F${set.feed}/${set.plungeFeed}`]);
  });

  it('Ø6 and Ø8 run at their own feeds; plunges use the plunge feed', () => {
    let p = run(project(), 'setToolFeed', { tool: 1, feed: 3500, plungeFeed: 700 });
    p = run(p, 'setToolFeed', { tool: 2, feed: 7000 });
    const f = feedsByTool(p);
    expect([...(f.get(1) ?? [])]).toEqual(['F3500/700']);
    expect([...(f.get(2) ?? [])]).toEqual([`F7000/${set.plungeFeed}`]);
    const r = buildToolpath(p, machine);
    for (const op of r.toolpath.operations) {
      for (const seg of op.segments) {
        for (const m of seg.moves) {
          if (m.kind === 'plunge') expect(m.feed).toBe(op.plungeFeed);
          else if (m.kind !== 'rapid') expect([op.feed, op.plungeFeed]).toContain(m.feed);
        }
      }
    }
  });

  it('the chip load of each tool uses its own feed', () => {
    const p = run(project(), 'setToolFeed', { tool: 1, feed: 3600 });
    const row = spindleSettingsOf(p, machine).find((r) => r.tool === 1);
    expect(row?.chipLoad).toBeCloseTo(3600 / (18000 * 2), 9);
  });

  it('a tool chosen for an operation takes its own set feeds (like its rpm)', () => {
    const p = run(project(), 'setOperationTool', { op: 'outer', tool: 1 });
    expect(recommendedFeeds(p, machine, set, 1)).toEqual({ feed: 4000, plungeFeed: 900 });
    expect(recommendedFeeds(project(), machine, set, 1)).toEqual({
      feed: set.feed,
      plungeFeed: set.plungeFeed,
    });
  });

  it('F words and the İLERLEME header line; none without overrides; checks pass', () => {
    const plain = exp(project());
    expect(plain).not.toMatch(/ILERLEME/);
    const p = run(project(), 'setToolFeed', { tool: 1, feed: 3500, plungeFeed: 700 });
    const own = exp(p);
    expect(own).toMatch(/F3500/);
    expect(own).toMatch(/F700/);
    expect(own).toMatch(
      new RegExp(
        `\\(ILERLEME T1: 3500 mm/dk, dalma 700 mm/dk elle, onerilen ${set.feed} / ${set.plungeFeed}\\)`,
      ),
    );
    expect(feedHeaders({ ...baseMeta, feeds: [] })).toEqual([]);
  });

  it('the post refuses an operation above the machine limit even past the toolpath', () => {
    const tp = buildToolpath(project(), machine).toolpath;
    const op = tp.operations[0];
    if (!op) throw new Error('no op');
    op.feed = 70_000;
    const g = generateGcode(
      tp,
      { profile: machine, version: 1, verification: 'draft' },
      postConfig('generic'),
      {
        projectName: 'T323',
        revision: 0,
        stock: { material: 'mdf', thickness: 18, sheetWidth: 2800, sheetHeight: 2070 },
      },
    );
    expect(g.ok).toBe(false);
  });

  it('the toolpath refuses a feed above the machine limit (FEED_OUT_OF_RANGE)', () => {
    const r = buildToolpath(project(), machine, { cutting: { feed: 70_000 } });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('FEED_OUT_OF_RANGE');
  });

  it('validation reports FEED_OUT_OF_RANGE only for the job tools', () => {
    const p = clone(project()) as Project;
    (p.cutting as Record<string, unknown>).feeds = { '1': { feed: 3000 }, '7': { feed: 3000 } };
    const issues = validateProject(p, { machine }).filter((i) => i.code === 'FEED_OUT_OF_RANGE');
    expect(issues).toEqual([]);
  });
});

describe('G-code check: feeds stay inside the machine limits (T323)', () => {
  it('an F above the machine limit is caught (R5 FEED_ABOVE_MACHINE)', () => {
    const g = golden('generic', GOLDEN_IDS[0] as string);
    expect(checkGcode(g.text, g.context).violations.filter((v) => v.severity === 'error')).toEqual(
      [],
    );
    const lines = g.text.split('\n');
    const at = lines.findIndex((l) => /^(N\d+ )?G1 .*F\d+/.test(l));
    expect(at).toBeGreaterThan(0);
    lines[at] = (lines[at] as string).replace(/F\d+(\.\d+)?/, 'F65000');
    const broken = lines.join('\n');
    const codes = checkGcode(broken, g.context).violations.map((v) => v.code);
    expect(codes).toContain('FEED_ABOVE_MACHINE');
  });
});

const baseMeta = {
  tabMode: 'small' as const,
  tabCount: 2,
  tabWidth: 10,
  tabHeight: 3,
  skin: null,
  leadIn: 'arc' as const,
  direction: 'climb' as const,
};
