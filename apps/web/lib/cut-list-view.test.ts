import type { Part, ValidationIssue } from '@nittcam/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PLAIN_VIEW,
  SORT_KEYS,
  cutListView,
  issueRows,
  matchesQuery,
  nextSort,
  type ViewOptions,
} from './cut-list-view';

const part = (
  name: string,
  w: number,
  h: number,
  extra: { qty?: number; group?: string; note?: string; top?: number; angle?: number } = {},
): Part =>
  ({
    id: name,
    name,
    qty: extra.qty ?? 1,
    ...(extra.group === undefined ? {} : { group: extra.group }),
    ...(extra.note === undefined ? {} : { note: extra.note }),
    grain:
      extra.angle === undefined
        ? { mode: 'free', angle: 0 }
        : { mode: 'fixed', angle: extra.angle },
    kind: 'rect',
    params: { w, h, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: extra.top ?? 0, right: 0, bottom: 0, left: 0 },
    templates: [],
  }) as Part;

const PARTS: Part[] = [
  part('Yan dikme', 560, 720, { qty: 2, group: 'Dolap 1' }),
  part('Kapak', 396, 716, { group: 'Dolap 2', note: 'Çift kapak' }),
  part('Raf', 528, 540, { qty: 3, top: 1 }),
  part('Taban', 564, 560, { group: 'Dolap 1', angle: 90 }),
  part('ŞAPKA', 600, 100),
];

const view = (opts: Partial<ViewOptions>, issues = new Set<number>()) =>
  cutListView(PARTS, issues, { ...PLAIN_VIEW, ...opts });

describe('cut list view (T123)', () => {
  it('lists every part in project order by default', () => {
    const v = view({});
    expect(v.order).toEqual([0, 1, 2, 3, 4]);
    expect(v.active).toBe(false);
  });

  it('searches name, group, note and size with Turkish folding', () => {
    expect(view({ query: 'sapka' }).order).toEqual([4]);
    expect(view({ query: 'ÇİFT' }).order).toEqual([1]);
    expect(view({ query: 'DOLAP' }).order).toEqual([0, 1, 3]);
    expect(view({ query: '528' }).order).toEqual([2]);
    expect(view({ query: '  ' }).order).toEqual([0, 1, 2, 3, 4]);
    expect(matchesQuery(PARTS[0] as Part, 'yan  DİKME')).toBe(true);
  });

  it('sorts by any column, stable, empty values last in both directions', () => {
    expect(view({ sort: { key: 'w', dir: 'asc' } }).order).toEqual([1, 2, 0, 3, 4]);
    expect(view({ sort: { key: 'w', dir: 'desc' } }).order).toEqual([4, 3, 0, 2, 1]);
    expect(view({ sort: { key: 'name', dir: 'asc' } }).order).toEqual([1, 2, 4, 3, 0]);
    expect(view({ sort: { key: 'group', dir: 'desc' } }).order).toEqual([1, 0, 3, 2, 4]);
    expect(view({ sort: { key: 'qty', dir: 'desc' } }).order).toEqual([2, 0, 1, 3, 4]);
    expect(view({ sort: { key: 'grain', dir: 'desc' } }).order).toEqual([3, 0, 1, 2, 4]);
    expect(view({ sort: { key: 'band', dir: 'desc' } }).order).toEqual([2, 0, 1, 3, 4]);
    expect(view({ sort: { key: 'note', dir: 'asc' } }).order).toEqual([1, 0, 2, 3, 4]);
  });

  it('cycles a header through ascending, descending and off', () => {
    const a = nextSort(null, 'w');
    expect(a).toEqual({ key: 'w', dir: 'asc' });
    const d = nextSort(a, 'w');
    expect(d).toEqual({ key: 'w', dir: 'desc' });
    expect(nextSort(d, 'w')).toBeNull();
    expect(nextSort(d, 'h')).toEqual({ key: 'h', dir: 'asc' });
  });

  it('filters the rows with issues', () => {
    const issues: ValidationIssue[] = [
      { code: 'X', severity: 'error', path: 'parts[2].params.w', message: '' },
      { code: 'Y', severity: 'warning', path: 'parts[4]', message: '' },
      { code: 'Z', severity: 'warning', path: 'stock.sheet', message: '' },
    ] as unknown as ValidationIssue[];
    const rows = issueRows(issues);
    expect([...rows]).toEqual([2, 4]);
    expect(view({ issuesOnly: true }, rows).order).toEqual([2, 4]);
    expect(view({ issuesOnly: true }).order).toEqual([]);
  });

  it('groups by label in first-row order, ungrouped last, collapsible', () => {
    const v = view({ grouped: true });
    expect(v.items.map((i) => (i.kind === 'group' ? `g:${i.key}` : i.index))).toEqual([
      'g:Dolap 1',
      0,
      3,
      'g:Dolap 2',
      1,
      'g:',
      2,
      4,
    ]);
    expect(v.items[0]).toMatchObject({ rows: 2, pieces: 3 });
    const c = view({ grouped: true, collapsed: new Set(['Dolap 1']) });
    expect(c.order).toEqual([1, 2, 4]);
    expect(c.items[0]).toMatchObject({ kind: 'group', key: 'Dolap 1', collapsed: true, rows: 2 });
    expect(c.matched).toBe(5);
  });

  it('never changes the parts array (view only), for any options', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 4 }),
        fc.option(
          fc.record({ key: fc.constantFrom(...SORT_KEYS), dir: fc.constantFrom('asc', 'desc') }),
        ),
        fc.boolean(),
        fc.boolean(),
        (query, sort, issuesOnly, grouped) => {
          const before = JSON.stringify(PARTS);
          const v = cutListView(PARTS, new Set([1, 3]), {
            query,
            sort: sort as ViewOptions['sort'],
            issuesOnly,
            grouped,
            collapsed: new Set(),
          });
          expect(JSON.stringify(PARTS)).toBe(before);
          // Every shown row is a real, distinct part index.
          expect(new Set(v.order).size).toBe(v.order.length);
          expect(v.order.every((i) => i >= 0 && i < PARTS.length)).toBe(true);
          expect(v.order.length).toBe(v.matched);
        },
      ),
    );
  });
});

describe('cut list view: edge band columns (T123)', () => {
  it('sorts by one edge', () => {
    const v = cutListView(PARTS, new Set(), {
      ...PLAIN_VIEW,
      sort: { key: 'edge-top', dir: 'desc' },
    });
    expect(v.order[0]).toBe(2);
  });
});
