import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  NO_MACHINE,
  PAGE_SIZE,
  filterOptions,
  filterProjects,
  foldTr,
  hasFilters,
  paginate,
  projectTabOf,
  sortProjects,
} from './project-list';
import type { ProjectListItem } from './projects-api';

function item(over: Partial<ProjectListItem> & { id: string }): ProjectListItem {
  return {
    name: over.id,
    status: 'draft',
    revision: 1,
    updatedAt: '2026-11-01T10:00:00.000Z',
    machine: 'Router A',
    deletedAt: null,
    material: 'mdf',
    thickness: 18,
    sheet: { width: 2800, height: 2070 },
    pieces: 1,
    lastExport: null,
    ...over,
  };
}

const items = [
  item({ id: '1', name: 'Mutfak ÇEKMECE', updatedAt: '2026-11-03T10:00:00.000Z' }),
  item({ id: '2', name: 'Işıklı tabela', status: 'produced', machine: null, material: 'acrylic' }),
  item({ id: '3', name: 'İç kapı', status: 'completed', machine: 'Router B' }),
  item({ id: '4', name: 'şifonyer 10', updatedAt: '2026-11-02T10:00:00.000Z' }),
  item({ id: '5', name: 'şifonyer 9', updatedAt: '2026-10-02T10:00:00.000Z' }),
];
const text = (i: ProjectListItem) => [i.name, i.machine ?? '', i.material].join(' ');

describe('Projeler list logic (T178)', () => {
  it('folds Turkish letters both ways', () => {
    expect(foldTr('ÇEKMECE')).toBe('cekmece');
    expect(foldTr('Işıklı')).toBe('isikli');
    expect(foldTr('İÇ KAPI')).toBe('ic kapi');
    expect(foldTr('ŞİFONYER ğüö')).toBe('sifonyer guo');
  });

  it('searches with folding; every word must match', () => {
    const q = (s: string) => filterProjects(items, { ...NO_FILTERS, q: s }, text).map((i) => i.id);
    expect(q('çekmece')).toEqual(['1']);
    expect(q('cekmece')).toEqual(['1']);
    expect(q('ışık')).toEqual(['2']);
    expect(q('isik')).toEqual(['2']);
    expect(q('ic kapi')).toEqual(['3']);
    expect(q('KAPI router b')).toEqual(['3']);
    expect(q('sifonyer')).toEqual(['4', '5']);
    expect(q('yok')).toEqual([]);
    expect(q('   ')).toHaveLength(5);
  });

  it('filters by status, machine (incl. none) and material', () => {
    const f = (over: Partial<typeof NO_FILTERS>) =>
      filterProjects(items, { ...NO_FILTERS, ...over }, text).map((i) => i.id);
    expect(f({ status: 'produced' })).toEqual(['2']);
    expect(f({ machine: 'Router B' })).toEqual(['3']);
    expect(f({ machine: NO_MACHINE })).toEqual(['2']);
    expect(f({ material: 'acrylic' })).toEqual(['2']);
    expect(f({ material: 'mdf', status: 'draft', q: 'şif' })).toEqual(['4', '5']);
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, machine: 'x' })).toBe(true);
  });

  it('sorts by date, name (Turkish, numeric) and deletion', () => {
    expect(sortProjects(items, 'updated').map((i) => i.id)).toEqual(['1', '4', '2', '3', '5']);
    expect(sortProjects(items, 'oldest').map((i) => i.id)).toEqual(['5', '2', '3', '4', '1']);
    // Turkish order: I < İ, M < Ş; "9" < "10" (numeric).
    expect(sortProjects(items, 'name').map((i) => i.id)).toEqual(['2', '3', '1', '5', '4']);
    expect(sortProjects(items, 'nameDesc').map((i) => i.id)).toEqual(['4', '5', '1', '3', '2']);
    const del = [
      item({ id: 'a', deletedAt: '2026-11-01T00:00:00.000Z' }),
      item({ id: 'b', deletedAt: '2026-11-05T00:00:00.000Z' }),
    ];
    expect(sortProjects(del, 'deleted').map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('offers the loaded machines and materials as filter options', () => {
    expect(filterOptions(items)).toEqual({
      machines: ['Router A', 'Router B'],
      hasNoMachine: true,
      materials: ['acrylic', 'mdf'],
    });
  });

  it('paginates: every item exactly once, page clamped', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 95 }), fc.integer({ min: -3, max: 10 }), (n, page) => {
        const all = Array.from({ length: n }, (_, i) => i);
        const p = paginate(all, page);
        expect(p.pages).toBe(Math.max(1, Math.ceil(n / PAGE_SIZE)));
        expect(p.page).toBeGreaterThanOrEqual(1);
        expect(p.page).toBeLessThanOrEqual(p.pages);
        const seen = Array.from({ length: p.pages }, (_, k) => paginate(all, k + 1).items).flat();
        expect(seen).toEqual(all);
        expect(p.items.length).toBeLessThanOrEqual(PAGE_SIZE);
      }),
    );
  });

  it('opens the tab named by ?sekme=', () => {
    expect(projectTabOf(undefined)).toBe('projects');
    expect(projectTabOf('silinenler')).toBe('deleted');
    expect(projectTabOf(['artik', 'x'])).toBe('offcuts');
    expect(projectTabOf('baska')).toBe('projects');
  });
});
