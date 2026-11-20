/**
 * B32 tester (T172–T174): the PDF and label routes only read projects of the default company. A
 * project of another company (inserted through the db repository) → 404, never its PDF.
 */
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import { pdfTestProject } from '../../../lib/server/pdf/pdf.testing';
import { GET as pdf } from './[id]/pdf/route';
import { GET as labels } from './[id]/labels/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('PDF routes multi-tenancy (B32 tester)', () => {
  it('another company project is not readable as PDF or labels', async () => {
    await companyScope();
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000000b2';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye' });
    const other = forCompany(handle.db, otherId);
    const foreign = await other.projects.create({
      name: 'Yabancı',
      data: pdfTestProject(),
      commands: [],
    });
    for (const paper of ['a4', 'a3']) {
      const res = await pdf(
        new Request(`http://test/x?revision=${foreign.revision}&paper=${paper}`),
        ctx(foreign.id),
      );
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).not.toBe('application/pdf');
    }
    const lab = await labels(
      new Request(`http://test/x?revision=${foreign.revision}&preset=a4-3x8`),
      ctx(foreign.id),
    );
    expect(lab.status).toBe(404);
  });

  it('rejects malformed revision and label numbers with 400', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const q of ['revision=abc', 'revision=-1', 'revision=1.5', 'revision=', 'revision=1e3']) {
      expect((await pdf(new Request(`http://test/x?${q}`), ctx(id))).status, q).toBe(400);
    }
    for (const q of [
      'revision=1&preset=nope',
      'revision=1&preset=custom&cols=2',
      'revision=1&dx=abc',
      'revision=1&dy=-20.5',
      'revision=1&preset=custom&cols=0&rows=1&width=10&height=10&left=0&top=0&gapX=0&gapY=0',
    ]) {
      expect((await labels(new Request(`http://test/x?${q}`), ctx(id))).status, q).toBe(400);
    }
  });
});
