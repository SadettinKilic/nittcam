/**
 * Seed data (D-016). `seedDefaultProfile` gives a new company the example machine
 * "Genel düz G-code router" (core `defaultMachineProfile`, marked `example: true`) so the
 * Makineler page and the Oluştur wizard have something to start from. It is a draft: the user
 * checks the values against the real machine and verifies it (§7.3).
 */
import { defaultMachineProfile } from '@nittcam/core';
import type { CompanyScope, MachineWithProfile } from './tenant';

export async function seedDefaultProfile(company: CompanyScope): Promise<MachineWithProfile> {
  return company.machines.createWithProfile(defaultMachineProfile());
}
