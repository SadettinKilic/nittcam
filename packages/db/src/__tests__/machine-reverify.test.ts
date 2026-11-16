/** Tester additions for T010: re-verification per change type and immutable versions (spec §7.3). */
import { randomUUID } from 'node:crypto';
import { defaultMachineProfile, type MachineProfile, type VerificationStage } from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { forCompany, type CompanyScope } from '../tenant';
import { newCompany, openTestDb } from './helpers';

let h: DbHandle;
let scope: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  scope = forCompany(h.db, (await newCompany(h, 'Reverify')).id);
});
afterAll(async () => {
  await h.close();
});

function fresh(): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = `Router ${randomUUID().slice(0, 6)}`;
  return p;
}

/** A machine whose current version carries a recorded verification at `stage`. */
async function verifiedMachine(stage: VerificationStage = 'verified') {
  const created = await scope.machines.createWithProfile(fresh());
  await scope.validations.create({
    machineProfileVersionId: created.version.id,
    toolSet: created.profile.tools,
    postVersion: created.version.postVersion,
    stage,
  });
  expect((await scope.machines.getWithProfile(created.machine.id))?.state).toBe(stage);
  return created;
}

const clone = (p: MachineProfile): MachineProfile => structuredClone(p);

type Case = [name: string, mutate: (p: MachineProfile) => void];

const REVERIFY: Case[] = [
  ['profile field (table width)', (p) => (p.table.width = 2800)],
  ['profile field (spindle max rpm)', (p) => (p.spindle.maxRpm = 20_000)],
  ['profile field (origin corner)', (p) => (p.origin.corner = 'backRight')],
  ['profile field (Z zero reference)', (p) => (p.zZero.reference = 'table')],
  ['profile field (safe Z)', (p) => (p.safeZ = 30)],
  ['profile field (controller family)', (p) => (p.identity.controller.family = 'Mach4')],
  [
    'tool added',
    (p) => p.tools.push({ number: 3, type: 'vBit', diameter: 12, fluteLength: 10, flutes: 2 }),
  ],
  [
    'tool removed',
    (p) => {
      p.tools = p.tools.filter((t) => t.number === 2);
      p.materials = [];
    },
  ],
  [
    'tool diameter changed',
    (p) => {
      const t = p.tools[0];
      if (t) t.diameter = 6.35;
    },
  ],
  ['post version changed', (p) => (p.post.version = '1.1')],
  ['post id changed', (p) => (p.post.id = 'mach3')],
];

describe('T010 re-verification after each change type (spec §7.3)', () => {
  for (const stage of ['air_cut_approved', 'test_cut_approved', 'verified'] as const) {
    it(`${stage}: every change type gives reverify_needed (saved state and read agree)`, async () => {
      for (const [name, mutate] of REVERIFY) {
        const m = await verifiedMachine(stage);
        const next = clone(m.profile);
        mutate(next);
        const saved = await scope.machines.saveProfile(m.machine.id, next);
        expect(saved.state, name).toBe('reverify_needed');
        expect((await scope.machines.getWithProfile(m.machine.id))?.state, name).toBe(
          'reverify_needed',
        );
      }
    });
  }

  it('name-only and notes-only changes do NOT re-verify', async () => {
    const m = await verifiedMachine();
    const renamed = clone(m.profile);
    renamed.identity.name = 'Yeni ad';
    expect((await scope.machines.saveProfile(m.machine.id, renamed)).state).toBe('verified');
    const noted = clone(renamed);
    noted.identity.notes = 'not';
    const saved = await scope.machines.saveProfile(m.machine.id, noted);
    expect(saved.state).toBe('verified');
    expect(saved.version.version).toBe(3);
  });

  it('re-saving an identical profile keeps the verification but still adds a version', async () => {
    const m = await verifiedMachine();
    const saved = await scope.machines.saveProfile(m.machine.id, clone(m.profile));
    expect(saved.state).toBe('verified');
    expect(saved.version.version).toBe(2);
  });

  it('reordering tools is not a change', async () => {
    const m = await verifiedMachine();
    const next = clone(m.profile);
    next.tools.reverse();
    expect((await scope.machines.saveProfile(m.machine.id, next)).state).toBe('verified');
  });

  it('a draft stays a draft after any change', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    for (const [name, mutate] of REVERIFY) {
      const next = clone(m.profile);
      mutate(next);
      expect((await scope.machines.saveProfile(m.machine.id, next)).state, name).toBe('draft');
    }
  });

  it('reverting the change brings the verification back (bound to profile content)', async () => {
    const m = await verifiedMachine();
    const changed = clone(m.profile);
    changed.table.width = 2800;
    expect((await scope.machines.saveProfile(m.machine.id, changed)).state).toBe('reverify_needed');
    expect((await scope.machines.saveProfile(m.machine.id, clone(m.profile))).state).toBe(
      'verified',
    );
  });
});

describe('T010 immutable versions', () => {
  it('editing creates v2; the v1 row and JSON stay unchanged', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    const [v1Before] = await scope.machines.listProfileVersions(m.machine.id);
    const snapshot = JSON.stringify(v1Before);

    const next = clone(m.profile);
    next.table.width = 3000;
    next.tools = [{ number: 1, type: 'flatEndMill', diameter: 3, fluteLength: 12, flutes: 1 }];
    next.materials = [];
    next.post.version = '2.0';
    const saved = await scope.machines.saveProfile(m.machine.id, next);
    expect(saved.version.version).toBe(2);
    expect(saved.version.id).not.toBe(v1Before?.id);

    const versions = await scope.machines.listProfileVersions(m.machine.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(JSON.stringify(versions[0])).toBe(snapshot);
    expect((versions[0]?.profile as MachineProfile).table.width).toBe(2440);
    expect(versions[0]?.postVersion).toBe('1.0');
    expect((versions[1]?.profile as MachineProfile).table.width).toBe(3000);
    expect(versions[1]?.postVersion).toBe('2.0');
  });

  it('a failed (invalid) save leaves machine row, versions and tools unchanged', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    const bad = clone(m.profile);
    bad.identity.name = 'Should not appear';
    bad.workEnvelope.x = -1;
    await expect(scope.machines.saveProfile(m.machine.id, bad)).rejects.toThrow();
    const after = await scope.machines.getWithProfile(m.machine.id);
    expect(after?.machine.name).toBe(m.profile.identity.name);
    expect(after?.version.version).toBe(1);
    expect(await scope.machines.listProfileVersions(m.machine.id)).toHaveLength(1);
  });

  it('the repository exposes no way to update or delete a version', () => {
    const repo = scope.machineProfileVersions as unknown as Record<string, unknown>;
    expect(repo.update).toBeUndefined();
    expect(repo.create).toBeUndefined();
    expect(repo.delete).toBeUndefined();
  });
});
