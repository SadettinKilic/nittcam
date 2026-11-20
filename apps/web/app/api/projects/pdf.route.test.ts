/**
 * T172: GET /api/projects/:id/pdf against an in-memory PGlite database: the PDF of the saved
 * revision, one page per sheet, stable bytes, stale revision 409, bad input 400, unknown 404.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { DbHandle } from '@nittcam/db';
import { PDFDocument } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../../../lib/projects-api';
import { pdfTestProject } from '../../../lib/server/pdf/pdf.testing';
import { companyScope } from '../../../lib/server/company';
import { POST as create } from './route';
import { GET as pdf } from './[id]/pdf/route';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function created(): Promise<ProjectDetail> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  if (!m) throw new Error('no seeded machine');
  const project = {
    ...pdfTestProject(),
    machine: { machineId: m.machine.id, profileVersion: m.version.version },
  };
  const res = await create(
    new Request('http://test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Çocuk odası', project }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectDetail;
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('GET /api/projects/:id/pdf (T172)', () => {
  it('returns the PDF of the saved revision with stable bytes', async () => {
    const d = await created();
    const get = (q: string) => pdf(new Request(`http://test/x?${q}`), ctx({ id: d.id }));
    const res = await get(`revision=${d.revision}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      `inline; filename="Cocuk-odasi-r${d.revision}-A4.pdf"`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get('etag')).toBe(`"${sha(bytes)}"`);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(d.project.layout.sheets.length);

    const again = new Uint8Array(await (await get(`revision=${d.revision}`)).arrayBuffer());
    expect(sha(again)).toBe(sha(bytes));
    const a3 = await get(`revision=${d.revision}&paper=a3&download=1`);
    expect(a3.headers.get('content-disposition')).toMatch(/^attachment; .*-A3\.pdf"$/);
  });

  it('refuses a stale revision, bad input and unknown projects', async () => {
    const d = await created();
    const get = (q: string, id = d.id) => pdf(new Request(`http://test/x?${q}`), ctx({ id }));
    const stale = await get(`revision=${d.revision + 1}`);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'conflict', currentRevision: d.revision });
    expect((await get('revision=0')).status).toBe(400);
    expect((await get(`revision=${d.revision}&paper=letter`)).status).toBe(400);
    expect((await get('revision=1', randomUUID())).status).toBe(404);
    expect((await get('revision=1', 'nope')).status).toBe(404);
  });
});
