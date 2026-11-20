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
import { estimateCutSeconds } from '../../../lib/server/pdf/cut-time';
import { POST as create } from './route';
import { GET as pdf } from './[id]/pdf/route';
import { GET as labels } from './[id]/labels/route';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function created(): Promise<ProjectDetail> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  if (!m) throw new Error('no seeded machine');
  const set = m.profile.materials[0];
  if (!set) throw new Error('no material set');
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
      `inline; filename="Cocuk_odasi_r${d.revision}_a4.pdf"`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get('etag')).toBe(`"${sha(bytes)}"`);
    const doc = await PDFDocument.load(bytes);
    // Layout pages, then one part list / report page (2 rows).
    expect(doc.getPageCount()).toBe(d.project.layout.sheets.length + 1);

    const again = new Uint8Array(await (await get(`revision=${d.revision}`)).arrayBuffer());
    expect(sha(again)).toBe(sha(bytes));
    const a3 = await get(`revision=${d.revision}&paper=a3&download=1`);
    expect(a3.headers.get('content-disposition')).toMatch(/^attachment; .*_r\d+_a3\.pdf"$/);
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

  it('T173: estimates the cut time from the program of the saved revision', async () => {
    const d = await created();
    const scope = await companyScope();
    const row = await scope.projects.get(d.id);
    if (!row) throw new Error('project missing');
    const seconds = await estimateCutSeconds(scope, row);
    expect(seconds).toBeGreaterThan(0);
    const noMachine = {
      ...row,
      data: { ...row.data, machine: { machineId: randomUUID(), profileVersion: 1 } },
    };
    expect(await estimateCutSeconds(scope, noMachine)).toBeNull();
    const noLayout = { ...row, data: { ...row.data, layout: { sheets: [] } } };
    expect(await estimateCutSeconds(scope, noLayout)).toBeNull();
  });
});

describe('GET /api/projects/:id/labels (T174)', () => {
  it('returns one label per piece on A4 pages, stable bytes, validated settings', async () => {
    const d = await created(); // 3 + 4 = 7 pieces
    const get = (q: string, id = d.id) =>
      labels(new Request(`http://test/x?revision=${q}`), ctx({ id }));
    const r = d.revision;
    const res = await get(`${r}&preset=a4-3x8`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      `inline; filename="Cocuk_odasi_r${r}_etiket.pdf"`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const again = new Uint8Array(await (await get(`${r}&preset=a4-3x8`)).arrayBuffer());
    expect(sha(again)).toBe(sha(bytes));

    // A 2 × 2 custom grid: 7 labels → 2 pages.
    const grid = 'cols=2&rows=2&width=80&height=50&left=10&top=10&gapX=2&gapY=2';
    const small = await get(`${r}&preset=custom&${grid}&dx=1.5&dy=-1`);
    expect(small.status).toBe(200);
    const smallDoc = await PDFDocument.load(new Uint8Array(await small.arrayBuffer()));
    expect(smallDoc.getPageCount()).toBe(2);

    const wide = 'cols=4&rows=8&width=70&height=37&left=0&top=0&gapX=0&gapY=0';
    expect((await get(`${r}&preset=custom&${wide}`)).status).toBe(400);
    expect((await get(`${r}&dx=30`)).status).toBe(400);
    expect((await get(`${r + 1}`)).status).toBe(409);
    expect((await get('1', randomUUID())).status).toBe(404);
  });
});
