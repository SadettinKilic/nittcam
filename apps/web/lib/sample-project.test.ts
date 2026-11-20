import {
  CommandStack,
  exampleMachineProfile,
  exportBlockingIssues,
  exportNc,
  nestProject,
  parseCommandLog,
  projectSchema,
  replayLog,
} from '@nittcam/core';
import { POST_CONFIGS } from '@nittcam/machines';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import type { MachineListItem } from './machines-api';
import { newProject } from './draft-project';
import { buildSampleProject, pickSampleMachine, SAMPLE_HINGE_ID } from './sample-project';

const AT = '2026-11-20T10:00:00.000Z';
const machine = {
  id: '7b0c3c5e-1111-4000-8000-000000000001',
  version: 1,
  profile: exampleMachineProfile(),
};
const t = { group: 'Örnek dolap', roles: tr.cutList.cabinet.roles };

function build() {
  let n = 0;
  const res = buildSampleProject(machine, [], t, () => `p${++n}`, AT);
  if (!res) throw new Error('sample not built');
  return res;
}

describe('buildSampleProject (T184)', () => {
  it('a cabinet on the sample machine: sides, top, bottom, shelf, two doors, no back', () => {
    const { project } = build();
    expect(project.machine).toEqual({ machineId: machine.id, profileVersion: 1 });
    expect(projectSchema.safeParse(project).success).toBe(true);
    const names = project.parts.map((p) => p.name);
    expect(names).toEqual(['Yan', 'Üst', 'Alt', 'Raf', 'Kapak']);
    expect(project.parts.every((p) => p.group === 'Örnek dolap')).toBe(true);
    const door = project.parts.find((p) => p.name === 'Kapak');
    expect(door?.qty).toBe(2);
  });

  it('every door carries the hinge cups on its left edge', () => {
    const { project } = build();
    const door = project.parts.find((p) => p.name === 'Kapak');
    expect(door?.templates).toHaveLength(1);
    expect(door?.templates[0]?.templateId).toBe(SAMPLE_HINGE_ID);
    expect(door?.templates[0]?.placement.edge).toBe('left');
    const others = project.parts.filter((p) => p.name !== 'Kapak');
    expect(others.every((p) => p.templates.length === 0)).toBe(true);
  });

  it('the command log replays to the same project (D-029)', () => {
    const { project, commands } = build();
    expect(commands.map((c) => c.command)).toEqual(['importCutList', 'addTemplate']);
    const log = parseCommandLog(JSON.parse(JSON.stringify(commands)));
    expect(log.ok).toBe(true);
    if (!log.ok) return;
    const stack = new CommandStack(newProject(machine));
    expect(replayLog(stack, log.entries)).toBe(commands.length);
    expect(stack.project).toEqual(project);
  });

  it('nests and exports a valid NC on the sample machine', () => {
    const { project } = build();
    expect(exportBlockingIssues(project, { machine: machine.profile })).toEqual([]);
    const nested = { ...project, layout: nestProject(project, { toolDiameter: 8 }).layout };
    const r = exportNc(
      nested,
      { profile: machine.profile, version: 1, verification: 'draft' },
      POST_CONFIGS[machine.profile.post.id],
    );
    expect(r.check?.violations).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.files.length).toBeGreaterThan(0);
  });
});

describe('pickSampleMachine (T184)', () => {
  const item = (id: string, example: boolean, archived = false): MachineListItem => ({
    id,
    name: id,
    controller: 'Mach3',
    version: 1,
    state: 'draft',
    example,
    table: { width: 1300, depth: 2500 },
    archived,
    maintenance: null,
  });

  it('prefers the active example machine, else the first active one', () => {
    expect(pickSampleMachine([item('a', false), item('ex', true)])?.id).toBe('ex');
    expect(pickSampleMachine([item('ex', true, true), item('b', false)])?.id).toBe('b');
    expect(pickSampleMachine([item('ex', true, true)])).toBeNull();
  });
});
