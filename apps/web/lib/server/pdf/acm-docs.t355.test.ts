import { createHash } from 'node:crypto';
import { LABEL_PRESETS, layoutDrawing, partLabels, type Project } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { renderLabelsPdf } from './labels-pdf';
import { sheetsHaveGrooves } from './layout-pages';
import { acmTrayPdfProject, pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';

// T355 (§6.6, analysis §5.6 / §5.9): ACM on the labels and the PDF; wood documents byte-identical.

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const pdf = (project: Project, paper: 'A4' | 'A3') =>
  renderProjectPdf({ project, projectName: 'Mutfak', revision: 3, paper, cutSeconds: 600 });
const labels = (project: Project) =>
  renderLabelsPdf({
    project,
    projectName: 'Mutfak',
    revision: 3,
    grid: LABEL_PRESETS['a4-3x8'],
    offset: { x: 0, y: 0 },
  });

describe('ACM documents (T355)', () => {
  it('wood PDF (A4, A3) and labels are byte-identical to main before T355', async () => {
    // Hashes taken from origin/main (48e390f9) with the same fixture before any T355 change.
    const mdf = pdfTestProject();
    expect(sha(await pdf(mdf, 'A4'))).toBe(
      'ebec1c2c934be894c8bb028a51cd1ab7d17538da63fcca40b4c778fa7f0ad079',
    );
    expect(sha(await pdf(mdf, 'A3'))).toBe(
      'a58b135fec8c49db72596f44e6f49a51c5ffb7dd03e2d7dacb962ac564248bad',
    );
    expect(sha(await labels(mdf))).toBe(
      '3e49327ee97aca39fa92e5c954aae2705c9bca0d9a0df29689ed712d71286dd0',
    );
  });

  it('labels of the tray: film arrow, fold count, no band marks', () => {
    const ls = partLabels(acmTrayPdfProject());
    expect(ls).toHaveLength(2);
    for (const l of ls) {
      expect(l.folds).toBe(4);
      expect(l.filmArrow).toBe(0);
      expect(l.bandedEdges).toEqual([]);
    }
    expect(partLabels(acmTrayPdfProject(false))[0]?.folds).toBeUndefined();
    expect(partLabels(pdfTestProject()).some((l) => 'filmArrow' in l || 'folds' in l)).toBe(false);
  });

  it('layout drawing carries the grooves (open lines), never as through cuts', () => {
    const sheets = layoutDrawing(acmTrayPdfProject());
    expect(sheetsHaveGrooves(sheets)).toBe(true);
    const part = sheets[0]?.parts[0];
    expect(part?.grooves).toHaveLength(4);
    expect(part?.grooves?.every((g) => !g.closed && g.points.length === 4)).toBe(true);
    expect(part?.inners).toEqual([]);
    expect(sheetsHaveGrooves(layoutDrawing(pdfTestProject()))).toBe(false);
    expect(layoutDrawing(pdfTestProject())[0]?.parts.some((p) => 'grooves' in p)).toBe(false);
  });

  it('tray PDF at A4 and A3 and its labels are deterministic and draw the grooves', async () => {
    const tray = acmTrayPdfProject();
    const flat = acmTrayPdfProject(false);
    for (const paper of ['A4', 'A3'] as const) {
      const a = await pdf(tray, paper);
      expect(sha(a)).toBe(sha(await pdf(tray, paper)));
      expect(sha(a)).not.toBe(sha(await pdf(flat, paper)));
    }
    expect(sha(await labels(tray))).toBe(sha(await labels(tray)));
    expect(sha(await labels(tray))).not.toBe(sha(await labels(flat)));
  });
});
