import { createHash } from 'node:crypto';
import { LABEL_PRESETS, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { renderLabelsPdf } from './labels-pdf';
import { pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';

// T348 (§3.6 "İşlenen yüz"): the PDF and the labels name the face that was up on ACM; wood
// documents are unchanged.

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function withStock(stock: Partial<Project['stock']>): Project {
  const p = pdfTestProject();
  return { ...p, stock: { ...p.stock, ...stock } };
}

const pdf = (project: Project) =>
  renderProjectPdf({ project, projectName: 'Tabela', revision: 1, paper: 'A4', cutSeconds: null });
const labels = (project: Project) =>
  renderLabelsPdf({
    project,
    projectName: 'Tabela',
    revision: 1,
    grid: LABEL_PRESETS['a4-3x8'],
    offset: { x: 0, y: 0 },
  });

describe('machined face on the PDF and labels (T348)', () => {
  it('MDF: documents unchanged (no face line)', async () => {
    const mdf = pdfTestProject();
    expect(sha(await pdf(mdf))).toBe(sha(await pdf(withStock({}))));
    expect(sha(await labels(mdf))).toBe(sha(await labels(withStock({}))));
  });

  it('ACM back and ACM front print different face lines (deterministic)', async () => {
    const back = withStock({ material: 'acm', thickness: 4, machinedFace: 'back' });
    const front = withStock({ material: 'acm', thickness: 4 });
    expect(sha(await pdf(back))).toBe(sha(await pdf(back)));
    expect(sha(await pdf(back))).not.toBe(sha(await pdf(front)));
    expect(sha(await labels(back))).not.toBe(sha(await labels(front)));
  });
});
