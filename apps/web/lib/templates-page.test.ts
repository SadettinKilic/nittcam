import { READY_TEMPLATES } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import type { TemplateItem } from './templates-api';
import {
  duplicateDraft,
  editedDraft,
  isChanged,
  splitTemplates,
  templatePreview,
  vertexPath,
} from './templates-page';

const hinge: TemplateItem = {
  id: 'a',
  name: 'Menteşe',
  version: 2,
  geometry: {
    holes: [{ id: 'cup', type: 'pocket', d: 35, cx: 0, cy: 0, depth: 12, tool: 1 }],
    inners: [],
  },
  params: { count: 2, spacing: 500, edgeDistance: 22.5, d: {} },
};
const copyName = (n: string) => `${n} (kopya)`;

describe('templates page model (T151)', () => {
  it('preview: every copy of every hole, diameter overrides, the reference edge in the box', () => {
    const p = templatePreview({ ...hinge, params: { ...hinge.params, d: { cup: 30 } } });
    expect(p.circles).toEqual([
      { cx: 0, cy: -250, r: 15 },
      { cx: 0, cy: 250, r: 15 },
    ]);
    expect(p.edgeX).toBe(-22.5);
    const [x, y, w, h] = p.box;
    expect(x).toBeLessThan(-22.5);
    expect(x + w).toBeGreaterThan(15);
    expect(y).toBeLessThan(-265);
    expect(y + h).toBeGreaterThan(265);
  });

  it('preview of every ready template has shapes and a finite box', () => {
    for (const t of READY_TEMPLATES) {
      const p = templatePreview(t);
      expect(p.circles.length).toBeGreaterThan(0);
      expect(p.box.every(Number.isFinite)).toBe(true);
    }
  });

  it('vertexPath: lines and arcs (y-up sweep), closed or open', () => {
    expect(
      vertexPath(
        [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 1 },
          { x: 10, y: 10, bulge: 0 },
        ],
        5,
        false,
      ),
    ).toBe('M0 5 L10 5 A5 5 0 0 1 10 15');
    expect(
      vertexPath(
        [
          { x: 0, y: 0, bulge: -1 },
          { x: 4, y: 0, bulge: -1 },
        ],
        0,
        true,
      ),
    ).toBe('M0 0 A2 2 0 0 0 4 0 A2 2 0 0 0 0 0 Z');
  });

  it('duplicate: deep copy, "(kopya)" name, never longer than 80', () => {
    const d = duplicateDraft(hinge, copyName);
    expect(d.name).toBe('Menteşe (kopya)');
    expect(d.geometry).toEqual(hinge.geometry);
    expect(d.geometry).not.toBe(hinge.geometry);
    const long = duplicateDraft({ ...hinge, name: 'x'.repeat(80) }, copyName);
    expect(long.name.length).toBeLessThanOrEqual(80);
    expect(long.name.endsWith('(kopya)')).toBe(true);
  });

  it('edit: a new draft only when the name or a param changed; geometry kept', () => {
    expect(isChanged(hinge, ' Menteşe ', hinge.params)).toBe(false);
    // key order of the stored params does not matter (jsonb reorders keys)
    const reordered = { d: {}, edgeDistance: 22.5, spacing: 500, count: 2 };
    expect(isChanged(hinge, 'Menteşe', reordered)).toBe(false);
    const params = { ...hinge.params, spacing: 600 };
    expect(isChanged(hinge, 'Menteşe', params)).toBe(true);
    expect(isChanged(hinge, 'Menteşe 2', hinge.params)).toBe(true);
    expect(editedDraft(hinge, ' Yeni ', params)).toEqual({
      name: 'Yeni',
      geometry: hinge.geometry,
      params,
    });
  });

  it('splits company templates from the ready library', () => {
    const s = splitTemplates([hinge, { ...hinge, id: 'ready-x', ready: true }]);
    expect(s.company.map((i) => i.id)).toEqual(['a']);
    expect(s.ready.map((i) => i.id)).toEqual(['ready-x']);
  });
});

describe('thumbnails to scale (P4)', () => {
  it('gives every box the largest span, centred on its own box', async () => {
    const { commonSpan, scaledBox } = await import('./templates-page');
    const small: [number, number, number, number] = [0, 0, 40, 40];
    const long: [number, number, number, number] = [-10, -5, 400, 30];
    const span = commonSpan([small, long]);
    expect(span).toEqual({ w: 400, h: 40 });
    expect(scaledBox(small, span)).toEqual([-180, 0, 400, 40]);
    expect(scaledBox(long, span)).toEqual([-10, -10, 400, 40]);
  });
});
