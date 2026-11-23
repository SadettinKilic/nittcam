/**
 * B62 round 2 tester: the checker must never pass a Mach3 file by skipping a rule. Mutations of
 * the two-tool Mach3 golden (T1 Ø6, T2 Ø8, manual change, no T word) and of a one-tool file.
 */
import { describe, expect, it } from 'vitest';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import { parseProject, type Project } from '../schema';
import { exampleMachineProfile, parseMachineProfileForSave } from '../machine';
import { validateProject } from '../validate';
import { canDownload, checkGcode, checkGcodeFiles } from './check';
import { golden, type PostId } from './check.testing';

const codes = (r: ReturnType<typeof checkGcode>) => r.violations.map((v) => v.code);
const two = golden('mach3', 'holes-through');
const NL = '\r\n';
const lines = () => two.text.split(NL);
const t2Start = () => lines().findIndex((l) => l.startsWith('(TAKIM DEGISTIR: T2'));

function expectBlocked(text: string, ctx = two.context): string[] {
  const r = checkGcode(text, ctx);
  expect(canDownload(r)).toBe(false);
  return codes(r);
}

describe('B62 r2: Mach3 checker fails closed', () => {
  it('baseline: the two-tool Mach3 golden is clean', () => {
    expect(checkGcode(two.text, two.context).violations).toEqual([]);
    expect(t2Start()).toBeGreaterThan(20);
  });

  it('every comment stripped → blocked (header and tool prompt gone)', () => {
    const text = lines()
      .map((l) => l.replace(/\([^)]*\)/g, '').trimEnd())
      .filter((l) => l !== '')
      .join(NL);
    expectBlocked(text);
  });

  it('header block stripped (everything before G21) → blocked', () => {
    const l = lines();
    const g21 = l.findIndex((x) => x.startsWith('G21'));
    expectBlocked(l.slice(g21).join(NL));
  });

  it('only the first line (DOGRULANMADI) removed → blocked', () => {
    expectBlocked(lines().slice(1).join(NL));
  });

  it('the two tool blocks swapped → blocked', () => {
    const l = lines();
    const a = l.findIndex((x) => x.startsWith('(TAKIM T1'));
    const b = t2Start();
    // end of the T2 block: the first line of the end sequence after the last cut (M5).
    const end = l.lastIndexOf('M5');
    expect(a).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(b);
    const swapped = [...l.slice(0, a), ...l.slice(b, end), ...l.slice(a, b), ...l.slice(end)];
    expectBlocked(swapped.join(NL));
  });

  it('T2 block with the T1 prompt text (operator mounts Ø6 for Ø8 moves) → blocked', () => {
    const l = lines();
    const b = t2Start();
    l[b] = (l[b] as string).replace('T2 D8.000', 'T1 D6.000');
    expectBlocked(l.join(NL));
  });

  it.each([2000, 3000, 6000])(
    'plunge feed of the second tool only raised to F%s → blocked',
    (f) => {
      const l = lines();
      const b = t2Start();
      let n = 0;
      for (let i = b; i < l.length; i++) {
        const x = l[i] as string;
        if (/Z-?\d/.test(x) && x.includes('F1500')) {
          l[i] = x.replace('F1500', `F${f}`);
          n++;
        }
      }
      expect(n).toBeGreaterThan(0);
      const c = expectBlocked(l.join(NL));
      expect(c.some((x) => x === 'PLUNGE_TOO_FAST' || x === 'MODEL_MISMATCH')).toBe(true);
    },
  );

  it('a T1 (Ø6) cutting move pushed off the sheet → CUTTER_OFF_SHEET', () => {
    const l = lines();
    const b = t2Start();
    // after a full-depth T1 arc: a straight cut out to X1 and back (the arcs stay intact).
    const i = l.findIndex((x, k) => k > 70 && k < b && /^G3 X[\d.]+ Y[\d.]+ I/.test(x));
    const m = /X([\d.]+) Y([\d.]+)/.exec(l[i] as string);
    if (!m) throw new Error('no arc');
    l.splice(i + 1, 0, `G1 X1.0000 Y${m[2]}`, `G1 X${m[1]} Y${m[2]}`);
    const c = expectBlocked(l.join(NL));
    expect(c).toContain('CUTTER_OFF_SHEET');
  });

  it('a removed first-tool pause → blocked', () => {
    const l = lines();
    l.splice(l.indexOf('M0'), 1);
    expectBlocked(l.join(NL));
  });

  it('a whole sheet program deleted → SHEET_MISSING', () => {
    const g = golden('mach3', 'cabinet-doors');
    const parts = g.context.layout ?? [];
    expect(parts.length).toBeGreaterThan(0);
    const { sheet, layout, operations, ...rest } = g.context;
    expect([sheet, layout === undefined, operations === undefined]).toBeDefined();
    const r = checkGcodeFiles([{ name: 'x_S1.tap', content: g.text, sheet: 0 }], {
      ...rest,
      layout: new Map([
        [0, parts],
        [1, parts],
      ]),
    });
    expect(canDownload(r)).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain('SHEET_MISSING');
    expect(checkGcodeFiles([], { ...rest, layout: new Map([[0, parts]]) }).ok).toBe(false);
  });
});

describe('B62 r2: margin below the tool is refused on every post', () => {
  function withMargin(margin: number): Project {
    const json = JSON.parse(JSON.stringify(cabinetDoors));
    json.nesting.margin = margin;
    const r = parseProject(json);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.project;
  }
  const posts: PostId[] = ['mach3', 'generic'];
  it.each(posts.flatMap((p) => [6, 4, 0].map((m) => [p, m] as const)))(
    '%s, margin %s with the Ø8 set → MARGIN_BELOW_TOOL_RADIUS error',
    (post, margin) => {
      const machine = golden(post, 'cabinet-doors').context.profile;
      const issues = validateProject(withMargin(margin), { machine });
      expect(
        issues.some((i) => i.code === 'MARGIN_BELOW_TOOL_RADIUS' && i.severity === 'error'),
      ).toBe(true);
    },
  );
  it.each(posts)('%s, margin 8 with the Ø8 set → no margin error', (post) => {
    const machine = golden(post, 'cabinet-doors').context.profile;
    expect(validateProject(withMargin(8), { machine }).map((i) => i.code)).not.toContain(
      'MARGIN_BELOW_TOOL_RADIUS',
    );
  });
});

describe('B62 r2: strict feed ceiling', () => {
  const base = golden('mach3', 'cabinet-doors');
  const withSet = (feed: number, plunge: number, extra: Record<string, number> = {}) => {
    const p = structuredClone(base.context.profile);
    Object.assign(p, extra);
    for (const m of p.materials) {
      m.feed = feed;
      m.plungeFeed = plunge;
    }
    return p;
  };
  const blocked = (p: ReturnType<typeof withSet>) =>
    validateProject(base.project, { machine: p }).some(
      (i) => i.code === 'MACHINE_FEED_ABOVE_MAX' && i.severity === 'error',
    );

  it('rapid 10 000: 10 000 / 5 000 pass, 10 100 or plunge 5 100 refused and blocked', () => {
    expect(base.context.profile.rapidFeed).toBe(10000);
    expect(parseMachineProfileForSave(withSet(10000, 5000)).ok).toBe(true);
    expect(blocked(withSet(10000, 5000))).toBe(false);
    for (const p of [withSet(10100, 1500), withSet(6000, 5100), withSet(59000, 29000)]) {
      expect(parseMachineProfileForSave(p).ok).toBe(false);
      expect(blocked(p)).toBe(true);
    }
  });

  it('maxFeed / maxPlungeFeed set: values up to them pass, above them refused', () => {
    const lim = { maxFeed: 20000, maxPlungeFeed: 8000 };
    expect(parseMachineProfileForSave(withSet(20000, 8000, lim)).ok).toBe(true);
    expect(blocked(withSet(20000, 8000, lim))).toBe(false);
    expect(parseMachineProfileForSave(withSet(20100, 8000, lim)).ok).toBe(false);
    expect(parseMachineProfileForSave(withSet(20000, 8100, lim)).ok).toBe(false);
    expect(blocked(withSet(20100, 8000, lim))).toBe(true);
  });

  it('the seeded example machine still validates without the feed error', () => {
    expect(blocked(exampleMachineProfile())).toBe(false);
  });
});
