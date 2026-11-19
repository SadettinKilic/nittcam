/**
 * The cut list's view (T123, spec §4.1): search, sort, the "hatalı satırlar" filter and groups.
 * View only: it lists project indexes in display order and never changes the project's part
 * order (that is `reorderParts`, an explicit command). Pure, so the rules are unit-tested.
 */
import type { Part, ValidationIssue } from '@nittcam/core';
import { foldTr } from '@nittcam/ui';
import { EDGES, type EdgeKey } from './cut-list-grid';

export type SortKey =
  'name' | 'group' | 'w' | 'h' | 'qty' | 'grain' | 'band' | `edge-${EdgeKey}` | 'note';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

export const SORT_KEYS: readonly SortKey[] = [
  'name',
  'group',
  'w',
  'h',
  'qty',
  'grain',
  'band',
  ...EDGES.map((e) => `edge-${e}` as const),
  'note',
];

export interface ViewOptions {
  query: string;
  sort: Sort | null;
  issuesOnly: boolean;
  grouped: boolean;
  /** Keys of collapsed groups ('' = parts without a group). */
  collapsed: ReadonlySet<string>;
}

export const PLAIN_VIEW: ViewOptions = {
  query: '',
  sort: null,
  issuesOnly: false,
  grouped: false,
  collapsed: new Set(),
};

export interface GroupItem {
  kind: 'group';
  /** The trimmed group label; '' = parts without a group. */
  key: string;
  /** Matching rows of the group (also when collapsed). */
  rows: number;
  /** Pieces (sum of qty) of those rows. */
  pieces: number;
  collapsed: boolean;
}

export interface PartItem {
  kind: 'part';
  /** Index of the part in `project.parts`. */
  index: number;
}

export type ViewItem = GroupItem | PartItem;

export interface CutListView {
  items: ViewItem[];
  /** Visible part indexes in display order (keyboard navigation, range selection). */
  order: number[];
  /** Rows that pass search and filter (collapsed ones included). */
  matched: number;
  /** True when the display order differs from the project order or rows are hidden. */
  active: boolean;
}

/** Group key of a part: the trimmed label, '' when it has none. */
export function groupKey(part: Pick<Part, 'group'>): string {
  return part.group?.trim() ?? '';
}

/** Project indexes of parts with a validation issue (`parts[i]` or `parts[i].…`). */
export function issueRows(issues: readonly ValidationIssue[]): Set<number> {
  const rows = new Set<number>();
  for (const issue of issues) {
    const m = /^parts\[(\d+)\]/.exec(issue.path);
    if (m) rows.add(Number(m[1]));
  }
  return rows;
}

/** Text a search matches: name, group, note and the size, folded (Turkish letters, case). */
function haystack(part: Part): string {
  const size = part.kind === 'rect' ? `${part.params.w} ${part.params.h}` : '';
  return foldTr([part.name, part.group ?? '', part.note ?? '', size].join(' '));
}

/** True when every word of the query occurs in the part's text (Turkish folding). */
export function matchesQuery(part: Part, query: string): boolean {
  const words = foldTr(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack(part);
  return words.every((w) => text.includes(w));
}

/** The value a column sorts by; `null` sorts last in both directions (e.g. W of a freeform part). */
function sortValue(part: Part, key: SortKey): string | number | null {
  switch (key) {
    case 'name':
      return part.name;
    case 'group':
      return groupKey(part) || null;
    case 'note':
      return part.note?.trim() || null;
    case 'w':
    case 'h':
      return part.kind === 'rect' ? part.params[key] : null;
    case 'qty':
      return part.qty;
    case 'grain':
      // Free first, then fixed by angle.
      return part.grain.mode === 'fixed' ? part.grain.angle : -1;
    case 'band':
      return EDGES.reduce((sum, e) => sum + part.edgeBand[e], 0);
    default:
      return part.edgeBand[key.slice(5) as EdgeKey];
  }
}

const collator = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' });

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** Indexes of `parts` sorted by `sort` (stable: equal values keep the project order). */
export function sortedIndexes(parts: readonly Part[], indexes: number[], sort: Sort | null) {
  if (!sort) return indexes;
  const sign = sort.dir === 'asc' ? 1 : -1;
  const values = new Map(indexes.map((i) => [i, sortValue(parts[i] as Part, sort.key)]));
  return [...indexes].sort((i, j) => {
    const a = values.get(i) ?? null;
    const b = values.get(j) ?? null;
    if (a === null || b === null) {
      if (a === b) return i - j;
      return a === null ? 1 : -1;
    }
    return sign * compare(a, b) || i - j;
  });
}

/** Next sort when a column header is pressed: none → ascending → descending → none. */
export function nextSort(sort: Sort | null, key: SortKey): Sort | null {
  if (!sort || sort.key !== key) return { key, dir: 'asc' };
  return sort.dir === 'asc' ? { key, dir: 'desc' } : null;
}

/**
 * The rows to show and their order. Grouped: one header per group, groups in the order of their
 * first row (so sorting by a column orders the groups too), parts without a group last.
 */
export function cutListView(
  parts: readonly Part[],
  issues: ReadonlySet<number>,
  opts: ViewOptions,
): CutListView {
  const matching = parts
    .map((_, i) => i)
    .filter(
      (i) => (!opts.issuesOnly || issues.has(i)) && matchesQuery(parts[i] as Part, opts.query),
    );
  const sorted = sortedIndexes(parts, matching, opts.sort);
  const filtered = matching.length !== parts.length;
  if (!opts.grouped) {
    const items: ViewItem[] = sorted.map((index) => ({ kind: 'part', index }));
    return { items, order: sorted, matched: matching.length, active: filtered || !!opts.sort };
  }
  const groups = new Map<string, number[]>();
  for (const i of sorted) {
    const key = groupKey(parts[i] as Part);
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0));
  const items: ViewItem[] = [];
  const order: number[] = [];
  for (const key of keys) {
    const rows = groups.get(key) ?? [];
    const collapsed = opts.collapsed.has(key);
    items.push({
      kind: 'group',
      key,
      rows: rows.length,
      pieces: rows.reduce((sum, i) => sum + (parts[i]?.qty ?? 0), 0),
      collapsed,
    });
    if (collapsed) continue;
    for (const index of rows) items.push({ kind: 'part', index });
    order.push(...rows);
  }
  const reordered = order.some((index, k) => index !== matching[k]);
  return {
    items,
    order,
    matched: matching.length,
    active: filtered || !!opts.sort || reordered || order.length !== matching.length,
  };
}
