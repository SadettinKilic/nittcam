import { createHash } from 'node:crypto';
import { cabinetParts, DEFAULT_CABINET, type Project } from '@nittcam/core';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import tr from '../../../messages/tr.json';
import { assemblySheet } from '../../preview3d/assembly-sheet';
import { pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';

// T389: the optional "Montaj föyü" page (exploded view + numbered part list), last in the PDF.

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const at = '2026-11-28T10:00:00Z';
const pdf = (project: Project) =>
  renderProjectPdf({ project, projectName: 'Dolap', revision: 1, paper: 'A4', cutSeconds: null });
const withSheet = (p: Project, sheet = true): Project => ({
  ...p,
  assembly: { instances: p.assembly?.instances ?? [], ...(sheet ? { sheet } : {}), updatedAt: at },
});

function cabinetProject(): Project {
  const r = cabinetParts({ ...DEFAULT_CABINET, width: 600 });
  if (!r.ok) throw new Error(r.error);
  return {
    stock: { thickness: 18 },
    settings: { dimensionMode: 'finished' },
    parts: r.parts.map((x, i) => ({
      id: `c-${i}`,
      name: tr.cutList.cabinet.roles[x.role],
      qty: x.qty,
      kind: 'rect',
      params: { w: x.w, h: x.h, r: 0 },
      holes: [],
      inners: [],
      edgeBand: x.edgeBand,
      group: 'Dolap',
      ...(x.thickness !== 18 ? { note: `${x.thickness} mm` } : {}),
    })),
  } as unknown as Project;
}

describe('assemblySheet (T389)', () => {
  it('numbers parts in list order, counts visible copies, culls hidden faces', () => {
    const s = assemblySheet(cabinetProject(), tr.cutList.cabinet.roles);
    if (!s) throw new Error('no sheet');
    expect(s.rows.map((r) => r.no)).toEqual(s.rows.map((_, i) => i + 1));
    const copies = s.rows.reduce((n, r) => n + r.qty, 0);
    expect(s.balloons).toHaveLength(copies);
    // A box shows at most 3 of its 6 faces from one direction.
    expect(s.faces.length).toBeLessThanOrEqual(copies * 3);
    expect(s.faces.length).toBeGreaterThanOrEqual(copies);
    // Painter's order: far to near.
    for (let i = 1; i < s.faces.length; i++)
      expect((s.faces[i]?.depth ?? 0) >= (s.faces[i - 1]?.depth ?? 0)).toBe(true);
  });
  it('hidden copies leave the sheet; nothing visible = no sheet', () => {
    const p = cabinetProject();
    const first = p.parts[0];
    if (!first) throw new Error('no part');
    const hideAll = {
      ...p,
      parts: [first],
      assembly: {
        instances: Array.from({ length: first.qty }, (_, copy) => ({
          id: `${first.id}#${copy}`,
          partId: first.id,
          copy,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          hidden: true,
        })),
        updatedAt: at,
      },
    } as Project;
    expect(assemblySheet(hideAll, tr.cutList.cabinet.roles)).toBeNull();
  });
});

describe('Montaj föyü page in the project PDF (T389)', () => {
  it('off by default: the PDF is unchanged; on: one more page, deterministic', async () => {
    const base = pdfTestProject();
    const plain = await pdf(base);
    expect(sha(await pdf(withSheet(base, false)))).toBe(sha(plain));
    const on = await pdf(withSheet(base));
    expect(sha(await pdf(withSheet(base)))).toBe(sha(on));
    const a = await PDFDocument.load(plain);
    const b = await PDFDocument.load(on);
    expect(b.getPageCount()).toBe(a.getPageCount() + 1);
  });
});

describe('Montaj föyü: mixed materials and bağlantı elemanları (T390)', () => {
  it('rows carry the shown material; aligned holes count as fasteners', async () => {
    const { applyCommand } = await import('@nittcam/core');
    const { newProject } = await import('../../draft-project');
    const { FLAT } = await import('../../preview3d/assembly-model');
    const run = (p: Project, name: string, params: unknown): Project => {
      const r = applyCommand(p, name, params);
      if (!r.ok) throw new Error(r.error.message);
      return r.project;
    };
    let p = newProject();
    p = run(p, 'addPart', { id: 'pn', name: 'Panel', params: { w: 300, h: 200, r: 0 }, qty: 1 });
    p = run(p, 'addPart', { id: 'br', name: 'Braket', params: { w: 60, h: 40, r: 0 }, qty: 1 });
    for (const [id, cx, cy] of [
      ['pn', 50, 50],
      ['br', 30, 20],
    ] as const)
      p = run(p, 'addHole', { id, hole: { id: 'h', type: 'through', tool: 1, d: 4, cx, cy } });
    p = run(p, 'setAssemblyPartLook', {
      partId: 'br',
      material: 'aluminium',
      thickness: 3,
      updatedAt: at,
    });
    const t = p.stock.thickness;
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
          position: [50, t + 1.5, 50],
          rotation: FLAT,
          hidden: false,
        },
      ],
      updatedAt: at,
    });
    p = run(p, 'setAssemblySheet', { on: true, updatedAt: at });
    const s = assemblySheet(p, tr.cutList.cabinet.roles);
    expect(s?.rows.map((r) => r.material)).toEqual([expect.any(String), 'aluminium']);
    expect(s?.rows[1]?.size[2]).toBe(3);
    expect(s?.fasteners).toEqual([{ kind: 'screw', d: 4, length: expect.any(Number), qty: 1 }]);
    const a = await pdf(p);
    expect(sha(await pdf(p))).toBe(sha(a));
  });
});
