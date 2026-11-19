'use client';

import { partBoxSize, type Part, type Project } from '@nittcam/core';
import { Input, Measure, cn } from '@nittcam/ui';
import { Search } from 'lucide-react';
import { memo, useState } from 'react';
import type { Messages } from '../../lib/messages';
import { matchesPart } from '../../lib/editor/part-search';
import { focusRing } from '../page/page-header';

/**
 * Left panel of the drawing board (T124, T135): the parts, click to select (Shift adds), with a
 * search over name, note and group. The search only filters the list (numbers stay the cut list
 * row numbers); the selection is the one the cut list shares. Compact density.
 */
export function BoardPartList({
  t,
  project,
  selection,
  onSelect,
}: {
  t: Messages['editor']['parts'];
  project: Project;
  selection: ReadonlySet<string>;
  onSelect: (id: string, additive: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const rows = project.parts.map((p, i) => ({ p, i })).filter(({ p }) => matchesPart(p, query));
  return (
    <section data-density="compact" className="flex flex-col gap-2 p-panel" aria-label={t.title}>
      {/* ≥ 1024 px the workspace panel header shows the title + count (T241). */}
      <div className="flex items-baseline justify-between gap-2 lg:hidden">
        <h2 className="text-sm font-semibold">{t.title}</h2>
        <span className="text-xs text-fg-muted tabular-nums">
          {t.count.replace('{count}', String(project.parts.length))}
        </span>
      </div>
      {project.parts.length > 0 ? (
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            type="search"
            inputSize="sm"
            aria-label={t.search}
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') {
                e.stopPropagation();
                setQuery('');
              }
            }}
            className="pl-8"
            data-testid="editor-part-search"
          />
        </div>
      ) : null}
      {rows.length === 0 && query !== '' ? (
        <p className="px-2 text-sm text-fg-muted" data-testid="editor-part-search-empty">
          {t.noMatch}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5" data-testid="editor-part-list">
        {rows.map(({ p, i }) => (
          <PartRow
            key={p.id}
            part={p}
            index={i}
            on={selection.has(p.id)}
            t={t}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One list row. Memoised (T137 performance budget): with 500 parts the board re-renders on every
 * pointer move and selection, and only the rows whose part or selected state changed redraw.
 * `onSelect` must be stable (the board passes a callback).
 */
const PartRow = memo(function PartRow({
  part: p,
  index: i,
  on,
  t,
  onSelect,
}: {
  part: Part;
  index: number;
  on: boolean;
  t: Messages['editor']['parts'];
  onSelect: (id: string, additive: boolean) => void;
}) {
  const size = partBoxSize(p);
  const name = p.name.trim() || t.unnamed;
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={(e) => onSelect(p.id, e.shiftKey)}
        className={cn(
          'flex h-row w-full items-center gap-2 rounded-md px-2 text-left text-sm',
          focusRing,
          on ? 'bg-accent-subtle text-accent-text' : 'hover:bg-surface-hover',
        )}
      >
        <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-fg-subtle tabular-nums">
          {i + 1}
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <Measure
          aria-hidden
          value={[size.w, size.h]}
          mono
          className="shrink-0 text-xs text-fg-muted"
        />
        {p.qty > 1 ? (
          <span aria-hidden className="shrink-0 font-mono text-xs text-fg-subtle">
            {t.qty.replace('{qty}', String(p.qty))}
          </span>
        ) : null}
      </button>
    </li>
  );
});
