/**
 * T021 tester additions: header contents, hostile project names, and an independent safety
 * re-check (spec §7.2) of the bytes the server stored and serves.
 */
import { createHash } from 'node:crypto';
import { applyCommand, nestingToolDiameter, type Project } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { ExportResponse } from '../../../lib/exports-api';
import type { ProjectDetail } from '../../../lib/projects-api';
import { POST as create } from './route';
import { POST as doExport } from './[id]/export/route';
import { GET as download } from '../exports/[id]/files/[name]/route';

const post = (body: unknown) =>
  new Request('http://test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function project(): Promise<Project> {
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
  } as Project;
  const run = (name: string, params: unknown) => {
    const r = applyCommand(p, name, params);
    if (!r.ok) throw new Error(r.error.message);
    p = r.project;
  };
  run('addPart', { id: 'a', name: 'A', qty: 3, params: { w: 400, h: 600, r: 0 } });
  run('runNesting', { toolDiameter: nestingToolDiameter(m.profile, p.stock) ?? 8 });
  return p;
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('T021 tester: exported bytes', () => {
  it('hostile project name cannot break out of the header comment; file passes the checks', async () => {
    const name = 'Ev) M30 (G0 Z-50\r\nM3 S99999 ğüşiöç';
    const res = await create(post({ name, project: await project() }));
    expect(res.status).toBe(201);
    const d = (await res.json()) as ProjectDetail;
    const ex = await doExport(
      post({ revision: d.revision, acceptUnverified: true }),
      ctx({ id: d.id }),
    );
    expect([200, 201]).toContain(ex.status);
    const out = (await ex.json()) as ExportResponse;
    expect(out.files.length).toBeGreaterThan(0);
    for (const f of out.files) {
      const dl = await download(
        new Request('http://test'),
        ctx({ id: out.exportId, name: f.name }),
      );
      expect(dl.status).toBe(200);
      const bytes = new Uint8Array(await dl.arrayBuffer());
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.hash);
      const text = Buffer.from(bytes).toString('latin1');
      // ASCII only, no exponent notation / NaN
      // eslint-disable-next-line no-control-regex -- ASCII check
      expect(text).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
      expect(text).not.toMatch(/NaN|undefined|\d[eE][+-]?\d/);
      const lines = text.split(/\r?\n/);
      // First line is the unverified marker; header comments are single well-formed (...) blocks.
      expect(lines[0]).toBe('(DOGRULANMADI, once air cut)');
      const proje = lines.find((l) => l.startsWith('(PROJE:'));
      expect(proje).toBeDefined();
      expect(proje).toMatch(/^\([^()]*\)$/);
      expect(lines.some((l) => /^\(REVIZYON: \d+\)$/.test(l))).toBe(true);
      expect(lines.some((l) => l.startsWith('(POST:'))).toBe(true);
      expect(lines.some((l) => l.startsWith('(DOGRULAMA:'))).toBe(true);
      // The injected text never became a command line.
      expect(lines.filter((l) => /^M30\b/.test(l)).length).toBeLessThanOrEqual(1);
      expect(lines.some((l) => /S99999/.test(l) && !l.startsWith('('))).toBe(false);
    }
  });
});

describe('B5 round 2 tester: grain lock export gate', () => {
  /** Part "a" fixed grain 0, copy 0 locked; then the sheet grain turns to 90 (lock now bad). */
  async function regrained(): Promise<Project> {
    let p = await project();
    const run = (name: string, params: unknown) => {
      const r = applyCommand(p, name, params);
      if (!r.ok) throw new Error(r.error.message);
      p = r.project;
    };
    run('setPartGrain', { id: 'a', mode: 'fixed', angle: 0 });
    const scope = await companyScope();
    const [m] = await scope.machines.listWithProfiles();
    run('runNesting', { toolDiameter: (m && nestingToolDiameter(m.profile, p.stock)) ?? 8 });
    run('lockPlacement', { partId: 'a', index: 0 });
    run('setGrain', { grain: 90 });
    return p;
  }

  async function exportOf(p: Project) {
    const res = await create(post({ name: 'Damar', project: p }));
    expect(res.status).toBe(201);
    const d = (await res.json()) as ProjectDetail;
    const ex = await doExport(
      post({ revision: d.revision, acceptUnverified: true }),
      ctx({ id: d.id }),
    );
    const scope = await companyScope();
    return {
      status: ex.status,
      body: (await ex.json()) as unknown,
      stored: await scope.exports.listForProject(d.id),
    };
  }

  it('bad lock via real commands → 422, Turkish message, nothing stored', async () => {
    const r = await exportOf(await regrained());
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/LOCKED_PLACEMENT_GRAIN/);
    expect(JSON.stringify(r.body)).toMatch(/damar yönüne uymuyor/);
    expect(r.stored).toEqual([]);
  });

  it('the same lock turned to an allowed angle exports normally (201, stored)', async () => {
    let p = await regrained();
    const r1 = applyCommand(p, 'lockPlacement', { partId: 'a', index: 0, rot: 90 });
    if (!r1.ok) throw new Error(r1.error.message);
    // Re-nest so the turned copy does not overlap its neighbours; the lock stays at 90.
    const r2 = applyCommand(r1.project, 'runNesting', { toolDiameter: 8 });
    if (!r2.ok) throw new Error(r2.error.message);
    p = r2.project;
    const r = await exportOf(p);
    expect(r.status).toBe(201);
    expect(r.stored).toHaveLength(1);
  });
});
