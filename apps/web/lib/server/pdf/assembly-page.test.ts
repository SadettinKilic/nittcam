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
