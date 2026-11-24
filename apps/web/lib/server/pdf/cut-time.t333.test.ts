import { exampleMachineProfile } from '@nittcam/core';
import type { CompanyScope } from '@nittcam/db';
import { describe, expect, it } from 'vitest';
import { pdfNc } from './cut-time';
import { pdfTestProject } from './pdf.testing';

/** A scope with only what `pdfNc` reads: the project's export rows and one profile version. */
function scopeWith(rows: unknown[]): CompanyScope {
  const profile = exampleMachineProfile();
  return {
    exports: { listForProject: async () => rows },
    machines: {
      getProfileVersion: async (_id: string, by: { id?: string }) =>
        by.id === 'pv1' ? { profile, version: { id: 'pv1', version: 1 }, state: 'draft' } : null,
    },
  } as unknown as CompanyScope;
}

const project = { id: 'p1', revision: 3, data: pdfTestProject() };

const nc = (revision: number, files: { name: string; sheet: number }[], kind = 'nc') => ({
  kind,
  projectRevision: revision,
  machineProfileVersionId: 'pv1',
  files,
});

describe('pdfNc (T333): the newest NC export of the revision', () => {
  it('null when the revision has no NC export (documents and other revisions do not count)', async () => {
    const rows = [
      nc(3, [{ name: 'Mutfak_r3_a4.pdf', sheet: 0 }], 'pdf'),
      nc(2, [{ name: 'X_r2_S1.tap', sheet: 0 }]),
    ];
    expect(await pdfNc(scopeWith(rows), project)).toBeNull();
  });

  it('takes the stored names per sheet, split parts in order, and the tool order', async () => {
    const rows = [
      nc(3, [
        { name: 'Mutfak_r3_S1_P1.tap', sheet: 0 },
        { name: 'Mutfak_r3_S1_P2.tap', sheet: 0 },
        { name: 'Mutfak_r3_S2.tap', sheet: 1 },
      ]),
      nc(3, [{ name: 'older_S1.tap', sheet: 0 }]),
    ];
    const out = await pdfNc(scopeWith(rows), project);
    expect(out?.sheets[0]?.files).toEqual(['Mutfak_r3_S1_P1.tap', 'Mutfak_r3_S1_P2.tap']);
    expect(out?.sheets[1]?.files).toEqual(['Mutfak_r3_S2.tap']);
    expect(out?.sheets[0]?.tools.length).toBeGreaterThan(0);
    expect(out?.sheets[0]?.tools[0]?.number).toBeGreaterThan(0);
    // the example machine changes tools by hand
    expect(out?.manual).toBe(true);
  });

  it('names without tools when the profile version is gone', async () => {
    const row = { ...nc(3, [{ name: 'M_S1.tap', sheet: 0 }]), machineProfileVersionId: 'gone' };
    const out = await pdfNc(scopeWith([row]), project);
    expect(out).toEqual({ sheets: { 0: { files: ['M_S1.tap'], tools: [] } }, manual: false });
  });
});
