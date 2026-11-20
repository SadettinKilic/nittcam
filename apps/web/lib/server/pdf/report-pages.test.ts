import { applyCommand, projectReport, type Project } from '@nittcam/core';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';
import {
  bandText,
  formatArea,
  formatCutTime,
  formatPercent,
  reportPageCount,
} from './report-pages';

describe('report formatting (T173)', () => {
  it('formats the cut time in minutes, rounded up', () => {
    expect(formatCutTime(754)).toBe('13 dk');
    expect(formatCutTime(3900)).toBe('1 sa 5 dk');
    expect(formatCutTime(5)).toBe('1 dk');
    expect(formatCutTime(null)).toBe('—');
  });

  it('formats percent and area the Turkish way', () => {
    expect(formatPercent(12.345)).toBe('%12,3');
    expect(formatArea(1.5)).toBe('1,50 m²');
  });

  it('names every banded edge with its thickness', () => {
    const band = { top: 0.8, right: 2, bottom: 1, left: 0.4 };
    expect(bandText({ band, bandedEdges: ['top', 'right', 'bottom', 'left'] })).toBe(
      'Üst 0,8 · Sağ 2 · Alt 1 · Sol 0,4',
    );
    expect(bandText({ band, bandedEdges: [] })).toBe('—');
  });
});

describe('part list pages (T173)', () => {
  /** A project with `rows` cut-list rows (one copy each). */
  function many(rows: number): Project {
    let p = pdfTestProject();
    for (let i = 0; i < rows - 2; i++) {
      const r = applyCommand(p, 'addPart', {
        id: `p${i}`,
        name: `Parça ${i}`,
        qty: 1,
        params: { w: 100, h: 100, r: 0 },
      });
      if (!r.ok) throw new Error(r.error.message);
      p = r.project;
    }
    return p;
  }

  it('fills further pages when the list is long', async () => {
    const p = many(60);
    const report = projectReport(p);
    const listPages = reportPageCount(report, 'A4');
    expect(listPages).toBeGreaterThan(1);
    expect(reportPageCount(report, 'A3')).toBeLessThan(listPages);
    const doc = await PDFDocument.load(
      await renderProjectPdf({
        project: p,
        projectName: 'Uzun liste',
        revision: 1,
        paper: 'A4',
        cutSeconds: null,
      }),
    );
    expect(doc.getPageCount()).toBe(Math.max(1, p.layout.sheets.length) + listPages);
  });

  it('a short list fits on one page with the summary', () => {
    expect(reportPageCount(projectReport(pdfTestProject()), 'A4')).toBe(1);
  });
});
