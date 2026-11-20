/**
 * Projeler list logic (T178, spec §3.4): Turkish search folding, filters (status, machine,
 * material), sort and pagination. Pure, so the page and the tests share it.
 */
import type { ProjectListItem, ProjectStatus } from './projects-api';

/** Rows per page. */
export const PAGE_SIZE = 20;

/** Filter value of "no machine selected" (a project whose machine is unknown to the company). */
export const NO_MACHINE = '__none__';

export interface ProjectFilters {
  /** Free text; matched folded (see `foldTr`). */
  q: string;
  /** '' = all. */
  status: ProjectStatus | '';
  /** Machine name, `NO_MACHINE`, or '' = all. */
  machine: string;
  /** Stored material id, or '' = all. */
  material: string;
}

export const NO_FILTERS: ProjectFilters = { q: '', status: '', machine: '', material: '' };

export const SORT_KEYS = ['updated', 'oldest', 'name', 'nameDesc', 'deleted'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/**
 * Lower case with Turkish rules, accents dropped and the Turkish letters folded to ASCII, so
 * "ÇEKMECE", "çekmece" and "cekmece" match, and "İ"/"I" both match "i".
 */
export function foldTr(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFKD').replace(/\p{M}/gu, '');
}

/** True when any filter is set (the free text included). */
export function hasFilters(f: ProjectFilters): boolean {
  return f.q.trim() !== '' || f.status !== '' || f.machine !== '' || f.material !== '';
}

/**
 * Items that pass every filter. `text(item)` is the searchable text of a row (name, machine,
 * material label, status label, ...); every word of the query must occur in it.
 */
export function filterProjects<T extends ProjectListItem>(
  items: readonly T[],
  f: ProjectFilters,
  text: (item: T) => string,
): T[] {
  const words = foldTr(f.q).split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (f.status && i.status !== f.status) return false;
    if (f.machine && (i.machine ?? NO_MACHINE) !== f.machine) return false;
    if (f.material && i.material !== f.material) return false;
    if (words.length === 0) return true;
    const hay = foldTr(text(i));
    return words.every((w) => hay.includes(w));
  });
}

const collator = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });

/** Sorted copy; ties fall back to the id so the order is stable. */
export function sortProjects<T extends ProjectListItem>(items: readonly T[], key: SortKey): T[] {
  const by: (a: T, b: T) => number =
    key === 'name'
      ? (a, b) => collator.compare(a.name, b.name)
      : key === 'nameDesc'
        ? (a, b) => collator.compare(b.name, a.name)
        : key === 'oldest'
          ? (a, b) => a.updatedAt.localeCompare(b.updatedAt)
          : key === 'deleted'
            ? (a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')
            : (a, b) => b.updatedAt.localeCompare(a.updatedAt);
  return [...items].sort((a, b) => by(a, b) || a.id.localeCompare(b.id));
}

export interface Page<T> {
  items: T[];
  /** 1-based, clamped into [1, pages]. */
  page: number;
  /** At least 1. */
  pages: number;
}

/** One page of `items`; a page past the end shows the last page. */
export function paginate<T>(items: readonly T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages };
}

/** The values the machine and material filters offer, from the loaded rows (sorted). */
export function filterOptions(items: readonly ProjectListItem[]): {
  machines: string[];
  hasNoMachine: boolean;
  materials: string[];
} {
  const machines = new Set<string>();
  const materials = new Set<string>();
  let hasNoMachine = false;
  for (const i of items) {
    if (i.machine === null) hasNoMachine = true;
    else machines.add(i.machine);
    materials.add(i.material);
  }
  return {
    machines: [...machines].sort(collator.compare),
    hasNoMachine,
    materials: [...materials].sort(collator.compare),
  };
}

/** Tabs of the page and their `?sekme=` values (T178: the tab is kept in the URL). */
export const PROJECT_TABS = { projects: null, offcuts: 'artik', deleted: 'silinenler' } as const;
export type ProjectTab = keyof typeof PROJECT_TABS;

/** The tab a `?sekme=` value opens (unknown → Projeler). */
export function projectTabOf(sekme: string | string[] | undefined): ProjectTab {
  const v = Array.isArray(sekme) ? sekme[0] : sekme;
  if (v === PROJECT_TABS.offcuts) return 'offcuts';
  if (v === PROJECT_TABS.deleted) return 'deleted';
  return 'projects';
}
