import { describe, expect, it } from 'vitest';
import { originMark, type PdfMachine } from './layout-pages';
import { pdfTestProject } from './pdf.testing';
import { renderProjectPdf } from './project-pdf';

const machine = (
  corner: 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight',
  offset = { x: 0, y: 0 },
): NonNullable<PdfMachine> => ({
  origin: { corner, xPositive: 'right', yPositive: 'back', sheetOffset: offset },
  zZero: { reference: 'materialTop', spoilboardAllowance: 0.5 },
  workEnvelope: { x: 3000, y: 2000, z: 100 },
});

describe('PDF sheet page: program-zero mark (B51, D-091)', () => {
  const sheet = { width: 1220, height: 1000 };

  it('marks the corner of the profile with its machine coordinates', () => {
    expect(originMark(sheet, machine('frontLeft'))).toEqual({
      cx: 0,
      cy: 0,
      x: 0,
      y: 0,
      left: true,
    });
    expect(originMark(sheet, machine('frontRight'))).toMatchObject({ cx: 1220, cy: 0, x: 0, y: 0 });
    expect(originMark(sheet, machine('backLeft'))).toMatchObject({ cx: 0, cy: 1000, x: 0, y: 0 });
    expect(originMark(sheet, machine('backRight'))).toMatchObject({ cx: 1220, cy: 1000 });
    // the sheet sits away from zero: its corner is not X0 Y0
    expect(originMark(sheet, machine('frontLeft', { x: 15, y: 20 }))).toMatchObject({
      x: 15,
      y: 20,
    });
  });

  it('the mark changes the page; same input gives the same bytes', async () => {
    const input = {
      project: pdfTestProject(),
      projectName: 'Mutfak',
      revision: 1,
      paper: 'A4' as const,
      cutSeconds: null,
    };
    const plain = await renderProjectPdf(input);
    const a = await renderProjectPdf({ ...input, machine: machine('frontLeft') });
    const b = await renderProjectPdf({ ...input, machine: machine('frontLeft') });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(plain))).toBe(false);
  });
});
