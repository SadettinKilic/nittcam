import { applyCommand, type Project } from '@nittcam/core';
import { PDFPage } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import tr from '../../../messages/tr.json';
import { newProject } from '../../draft-project';
import { FLAT } from '../../preview3d/assembly-model';
import { renderProjectPdf } from './project-pdf';

// T390 tester: the Montaj föyü text of a wood panel + aluminium bracket with aligned holes.
const at = '2026-11-28T10:00:00Z';
const run = (p: Project, name: string, params: unknown): Project => {
  const r = applyCommand(p, name, params);
  if (!r.ok) throw new Error(r.error.message);
  return r.project;
};

function mixed(look: boolean): Project {
  let p = newProject();
  p = run(p, 'addPart', { id: 'pn', name: 'Panel', params: { w: 300, h: 200, r: 0 }, qty: 1 });
  p = run(p, 'addPart', { id: 'br', name: 'Braket', params: { w: 60, h: 40, r: 0 }, qty: 1 });
  for (const [id, cx, cy] of [
    ['pn', 50, 50],
    ['br', 30, 20],
  ] as const)
    p = run(p, 'addHole', { id, hole: { id: 'h', type: 'through', tool: 1, d: 4, cx, cy } });
  if (look)
    p = run(p, 'setAssemblyPartLook', {
      partId: 'br',
      material: 'aluminium',
      thickness: 3,
      updatedAt: at,
    });
  const t = p.stock.thickness;
  const tb = look ? 3 : t;
  p = run(p, 'setAssemblyInstances', {
    instances: [
      {
        id: 'pn#0',
        partId: 'pn',
        copy: 0,
        position: [150, t / 2, 0],
        rotation: FLAT,
        hidden: false,
      },
      {
        id: 'br#0',
        partId: 'br',
        copy: 0,
        position: [50, t + tb / 2, 50],
        rotation: FLAT,
        hidden: false,
      },
    ],
    updatedAt: at,
  });
  return run(p, 'setAssemblySheet', { on: true, updatedAt: at });
}

async function texts(project: Project): Promise<string[]> {
  const out: string[] = [];
  vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (_v: string) {
    out.push(_v);
  });
  await renderProjectPdf({
    project,
    projectName: 'Dolap',
    revision: 1,
    paper: 'A4',
    cutSeconds: null,
  });
  return out;
}
afterEach(() => vi.restoreAllMocks());

describe('Montaj föyü text (T390 tester)', () => {
  it('mixed: Malzeme column, aluminium row and a Bağlantı elemanı row', async () => {
    const t = await texts(mixed(true));
    expect(t).toContain('Malzeme');
    expect(t.some((s) => s.includes(tr.materials.aluminium))).toBe(true);
    expect(t.some((s) => /^Bağlantı elemanı: vida Ø4/.test(s))).toBe(true);
  });
  it('single material: no Malzeme column', async () => {
    const t = await texts(mixed(false));
    expect(t).toContain('Panel');
    expect(t).not.toContain('Malzeme');
  });
});
