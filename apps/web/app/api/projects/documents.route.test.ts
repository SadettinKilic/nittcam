/**
 * T176: documents (DXF, PDF, labels) stored as export records, history of all types, the zip
 * bundle of a multi-sheet NC export (same names and bytes as the single downloads + OKU.txt), and
 * the Projeler "last export" staying NC. In-memory PGlite + temporary storage.
 */
import { applyCommand, nestingToolDiameter, writeProjectDxf, type Project } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { ExportRecord, ExportResponse } from '../../../lib/exports-api';
import type { ProjectDetail, ProjectListItem } from '../../../lib/projects-api';
import { unzipStore } from '../../../lib/server/zip';
import { GET as list, POST as create } from './route';
import { POST as doExport } from './[id]/export/route';
import { POST as documents } from './[id]/documents/route';
import { GET as history } from './[id]/exports/route';
import { GET as download } from '../exports/[id]/files/[name]/route';
import { GET as zip } from '../exports/[id]/zip/route';

const post = (body: unknown) =>
  new Request('http://test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

/** Three 1300 × 2000 parts on 2800 × 2070 sheets: two sheets. */
async function twoSheetProject(): Promise<Project> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  const set = m?.profile.materials[0];
  if (!m || !set) throw new Error('no seeded machine');
  let p = {
    schemaVersion: 2,
    machine: { machineId: m.machine.id, profileVersion: m.version.version },
    stock: {
      material: set.material,
      thickness: set.thickness,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as unknown as Project;
  const run = (name: string, params: unknown) => {
    const r = applyCommand(p, name, params);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    p = r.project;
  };
  run('addPart', { id: 'yan', name: 'Yan', qty: 3, params: { w: 1300, h: 2000, r: 0 } });
  run('runNesting', { toolDiameter: nestingToolDiameter(m.profile, p.stock) ?? 8 });
  return p;
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('export step documents and zip (T176)', () => {
  it('stores every document type once, lists all types in the history, zips the NC files', async () => {
    const project = await twoSheetProject();
    expect(project.layout.sheets.length).toBe(2);
    const res = await create(post({ name: 'Dolap yanları', project }));
    const d = (await res.json()) as ProjectDetail;
    const id = d.id;

    const types = ['dxf-dizilim', 'dxf-parcalar', 'pdf-a4', 'pdf-a3'] as const;
    for (const type of types) {
      const r = await documents(post({ revision: d.revision, type }), ctx({ id }));
      expect(r.status, type).toBe(201);
      const rec = (await r.json()) as ExportResponse;
      expect(rec.files).toHaveLength(1);
      expect(rec.unverified).toBe(false);
      expect(rec.zipUrl).toBeNull();
      // Again: the same record (idempotent, same bytes).
      const again = await documents(post({ revision: d.revision, type }), ctx({ id }));
      expect(again.status).toBe(200);
      expect(((await again.json()) as ExportResponse).exportId).toBe(rec.exportId);
      const file = rec.files[0];
      if (!file) throw new Error('no file');
      const dl = await download(
        new Request('http://test'),
        ctx({ id: rec.exportId, name: file.name }),
      );
      const bytes = new Uint8Array(await dl.arrayBuffer());
      if (type.startsWith('dxf')) {
        expect(file.name).toBe(`Dolap_yanlari_r${d.revision}_${type.slice(4)}.dxf`);
        expect(new TextDecoder().decode(bytes)).toBe(
          writeProjectDxf(project, type === 'dxf-dizilim' ? 'layout' : 'parts'),
        );
      } else {
        expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
      }
    }
    const labels = await documents(
      post({ revision: d.revision, type: 'etiket', labels: 'preset=a4-3x8' }),
      ctx({ id }),
    );
    expect(labels.status).toBe(201);
    expect(
      (await documents(post({ revision: d.revision, type: 'etiket' }), ctx({ id }))).status,
    ).toBe(400);
    expect(
      (await documents(post({ revision: d.revision + 1, type: 'pdf-a4' }), ctx({ id }))).status,
    ).toBe(409);
    expect((await documents(post({ revision: d.revision, type: 'x' }), ctx({ id }))).status).toBe(
      400,
    );

    // NC export of two sheets: two files, a zip link.
    const nc = await doExport(post({ revision: d.revision, acceptUnverified: true }), ctx({ id }));
    expect(nc.status).toBe(201);
    const ncRec = (await nc.json()) as ExportResponse;
    expect(ncRec.kind).toBe('nc');
    expect(ncRec.files.length).toBe(2);
    expect(ncRec.zipUrl).toBe(`/api/exports/${ncRec.exportId}/zip`);

    const z = await zip(new Request('http://test'), ctx({ id: ncRec.exportId }));
    expect(z.status).toBe(200);
    expect(z.headers.get('content-disposition')).toBe(
      `attachment; filename="Dolap_yanlari_r${d.revision}_nc.zip"`,
    );
    const zipBytes = new Uint8Array(await z.arrayBuffer());
    const entries = unzipStore(zipBytes);
    expect(entries.map((e) => e.name)).toEqual([...ncRec.files.map((f) => f.name), 'OKU.txt']);
    for (const f of ncRec.files) {
      const single = await download(
        new Request('http://test'),
        ctx({ id: ncRec.exportId, name: f.name }),
      );
      const entry = entries.find((e) => e.name === f.name);
      expect(entry?.bytes).toEqual(new Uint8Array(await single.arrayBuffer()));
    }
    const readme = new TextDecoder().decode(entries.at(-1)?.bytes);
    for (const f of ncRec.files) expect(readme).toContain(`Plaka ${f.sheet + 1}: ${f.name}`);
    expect(readme).toContain(ncRec.files[0]?.hash ?? 'x');
    // Same export → same zip bytes.
    const z2 = await zip(new Request('http://test'), ctx({ id: ncRec.exportId }));
    expect(new Uint8Array(await z2.arrayBuffer())).toEqual(zipBytes);

    // History: every type.
    const rows = (await (
      await history(new Request('http://test'), ctx({ id }))
    ).json()) as ExportRecord[];
    expect(rows.map((r) => (r.kind === 'nc' ? 'nc' : r.post.id)).sort()).toEqual(
      ['dxf-dizilim', 'dxf-parcalar', 'etiket', 'nc', 'pdf-a3', 'pdf-a4'].sort(),
    );

    // Projeler "Son dışa aktarma" stays the NC export even when a document came later.
    await documents(post({ revision: d.revision, type: 'dxf-parcalar' }), ctx({ id }));
    const items = (await (await list()).json()) as ProjectListItem[];
    expect(items.find((i) => i.id === id)?.lastExport?.exportId).toBe(ncRec.exportId);
  });

  it('zip of an unknown export is 404; a document needs a layout (parts DXF does not)', async () => {
    expect((await zip(new Request('http://test'), ctx({ id: 'nope' }))).status).toBe(404);
    const scope = await companyScope();
    const [m] = await scope.machines.listWithProfiles();
    if (!m) throw new Error('no machine');
    let p = await twoSheetProject();
    p = { ...p, layout: { sheets: [] } };
    const d = (await (
      await create(post({ name: 'Dizilimsiz', project: p }))
    ).json()) as ProjectDetail;
    expect(
      (await documents(post({ revision: d.revision, type: 'pdf-a4' }), ctx({ id: d.id }))).status,
    ).toBe(422);
    expect(
      (await documents(post({ revision: d.revision, type: 'dxf-parcalar' }), ctx({ id: d.id })))
        .status,
    ).toBe(201);
  });
});
