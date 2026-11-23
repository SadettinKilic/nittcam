import { describe, expect, it } from 'vitest';
import { machineFeedLimits, parseMachineProfile, type MachineProfile } from '../machine';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { clone, projectOf } from './toolpath.testing';

// B62 tester (T330 abuse): the derived feed ceiling never goes below the machine's own highest set
// feed. A typo in the machine's own material set (one zero too many) must not give a silent,
// green file at 59 000 / 29 000 on a rapid-10 000 machine.

const base: MachineProfile = goldenProfile('generic'); // rapid 10 000, MDF 18: 6000 / 1500

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

function feedIssues(machine: MachineProfile): string[] {
  return [
    ...validateProject(project(), { machine }).map((i) => i.code),
    ...buildToolpath(project(), machine).errors.map((e) => e.code),
    ...buildToolpath(project(), machine).warnings.map((w) => w.code),
  ].filter((c) => /FEED|PLUNGE|CHIP/.test(c));
}

describe('B62 tester: abusing the "never below the machine’s own set" rule', () => {
  it('a machine material set typed as 59 000 / 29 000 (rapid 10 000) is refused or warned', () => {
    const m = clone(base) as MachineProfile;
    const mat = m.materials[0];
    if (!mat) throw new Error('no material');
    mat.feed = 59_000;
    mat.plungeFeed = 29_000;
    const parsed = parseMachineProfile(m);
    const limits = machineFeedLimits(m);
    // Either the profile refuses the set above the rapid rate, or the job warns/errs.
    const refused = !parsed.ok;
    const issues = refused ? [] : feedIssues(m);
    expect({ refused, issues, limits }).toMatchObject(
      refused ? { refused: true } : { issues: expect.arrayContaining([expect.any(String)]) },
    );
  });

  it('plunge set typo 15 000 for 1 500 in the machine material: refused or warned', () => {
    const m = clone(base) as MachineProfile;
    const mat = m.materials[0];
    if (!mat) throw new Error('no material');
    mat.plungeFeed = 15_000;
    const parsed = parseMachineProfile(m);
    const refused = !parsed.ok;
    const issues = refused ? [] : feedIssues(m);
    expect(refused || issues.length > 0).toBe(true);
  });

  it('a very high rapid rate (100 000) lifts the ceiling only to the 60 000 bound', () => {
    const m = { ...clone(base), rapidFeed: 100_000 } as MachineProfile;
    expect(machineFeedLimits(m).feed.max).toBe(60_000);
    expect(machineFeedLimits(m).plungeFeed.max).toBe(30_000);
  });
});
