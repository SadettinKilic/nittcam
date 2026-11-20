/**
 * T177: GET /api/projects/:id/report — the report summary of the saved revision equals the numbers
 * the PDF report draws (same `projectReport`, same cut-time estimate, same tile texts).
 */
import { randomUUID } from 'node:crypto';
import { projectReport } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../../../lib/projects-api';
import { summaryTiles, type ReportSummary } from '../../../lib/report-summary';
import { companyScope } from '../../../lib/server/company';
import { estimateCutSeconds } from '../../../lib/server/pdf/cut-time';
import { pdfTestProject } from '../../../lib/server/pdf/pdf.testing';
import { POST as create } from './route';
import { GET as report } from './[id]/report/route';

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function created(): Promise<ProjectDetail> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  const set = m?.profile.materials[0];
  if (!m || !set) throw new Error('no seeded machine');
  const base = pdfTestProject();
  const project = {
    ...base,
    machine: { machineId: m.machine.id, profileVersion: m.version.version },
    stock: { ...base.stock, material: set.material, thickness: set.thickness },
  };
  const res = await create(
    new Request('http://test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rapor', project }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectDetail;
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('GET /api/projects/:id/report (T177)', () => {
  it('returns the PDF report values of the saved revision', async () => {
    const d = await created();
    const res = await report(
      new Request(`http://test/x?revision=${d.revision}`),
      ctx({ id: d.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportSummary;

    const scope = await companyScope();
    const row = await scope.projects.get(d.id);
    if (!row) throw new Error('missing');
    const cut = await estimateCutSeconds(scope, row);
    const pdf = projectReport(row.data, cut);
    expect(body).toEqual({
      revision: d.revision,
      sheetCount: pdf.sheetCount,
      wastePercent: pdf.wastePercent,
      wasteAreaM2: pdf.wasteAreaM2,
      partAreaM2: pdf.partAreaM2,
      sheetAreaM2: pdf.sheetAreaM2,
      totalPieces: pdf.totalPieces,
      unplaced: pdf.unplaced,
      cutSeconds: pdf.cutSeconds,
    });
    expect(body.sheetCount).toBeGreaterThan(0);
    expect(body.totalPieces).toBeGreaterThan(0);
    // The card shows exactly the tile texts the PDF draws.
    expect(summaryTiles(body)).toEqual(summaryTiles(pdf));
    expect(summaryTiles(body).map((t) => t.key)).toEqual([
      'sheets',
      'waste',
      'wasteArea',
      'partArea',
      'pieces',
      'cutTime',
    ]);
  });

  it('refuses a stale revision, bad input and unknown projects', async () => {
    const d = await created();
    const get = (id: string, q: string) => report(new Request(`http://test/x?${q}`), ctx({ id }));
    expect((await get(d.id, `revision=${d.revision + 1}`)).status).toBe(409);
    expect((await get(d.id, 'revision=0')).status).toBe(400);
    expect((await get(d.id, '')).status).toBe(400);
    expect((await get(randomUUID(), 'revision=1')).status).toBe(404);
    expect((await get('nope', 'revision=1')).status).toBe(404);
  });
});
