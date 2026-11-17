/**
 * Seed data (D-016, D-028). `seedDefaultProfile` gives a new company the example machine
 * "Örnek router (Mach3)" (core `exampleMachineProfile`, marked `example: true`) so the
 * Makineler page, the parts step and the simulation have something that exports end to end.
 * It is a draft: the user checks the values against the real machine and verifies it (§7.3).
 *
 * `upgradeExampleProfile` moves companies seeded before T020 (the generic example, which cannot
 * export) to the new example, **append-only** and only when nobody touched the old one.
 */
import { exampleMachineProfile, isLegacyExampleProfile } from '@nittcam/core';
import type { CompanyScope, MachineWithProfile } from './tenant';

export async function seedDefaultProfile(company: CompanyScope): Promise<MachineWithProfile> {
  return company.machines.createWithProfile(exampleMachineProfile());
}

/**
 * For every machine of the company whose profile history is exactly one version equal to the old
 * seeded example (`isLegacyExampleProfile`, `example: true`), saves the new example as version 2
 * (`saveProfile`: a new immutable version, never an update). Edited machines (more versions or
 * any changed value) are left alone. Idempotent: an upgraded machine has two versions, so a second
 * run changes nothing. Returns the upgraded machines.
 */
export async function upgradeExampleProfile(company: CompanyScope): Promise<MachineWithProfile[]> {
  const upgraded: MachineWithProfile[] = [];
  for (const m of await company.machines.listWithProfiles()) {
    if (!m.profile.example || m.version.version !== 1) continue;
    if (!isLegacyExampleProfile(m.profile)) continue;
    const versions = await company.machines.listProfileVersions(m.machine.id);
    if (versions.length !== 1) continue;
    upgraded.push(await company.machines.saveProfile(m.machine.id, exampleMachineProfile()));
  }
  return upgraded;
}
