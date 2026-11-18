'use client';

import { partBoxSize, type Project } from '@nittcam/core';
import { Measure, cn } from '@nittcam/ui';
import type { Messages } from '../../lib/messages';
import { focusRing } from '../page/page-header';

/** Left panel of the drawing board: the parts, click to select (Shift adds). Compact density. */
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
  return (
    <section data-density="compact" className="flex flex-col gap-2 p-panel" aria-label={t.title}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.title}</h2>
        <span className="text-xs text-fg-muted tabular-nums">
          {t.count.replace('{count}', String(project.parts.length))}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5" data-testid="editor-part-list">
        {project.parts.map((p, i) => {
          const size = partBoxSize(p);
          const on = selection.has(p.id);
          const name = p.name.trim() || t.unnamed;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={t.select.replace('{name}', name)}
                onClick={(e) => onSelect(p.id, e.shiftKey)}
                className={cn(
                  'flex h-row w-full items-center gap-2 rounded-md px-2 text-left text-sm',
                  focusRing,
                  on ? 'bg-accent-subtle text-accent-text' : 'hover:bg-surface-hover',
                )}
              >
                <span className="w-6 shrink-0 font-mono text-xs text-fg-subtle tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <Measure value={[size.w, size.h]} mono className="shrink-0 text-xs text-fg-muted" />
                {p.qty > 1 ? (
                  <span className="shrink-0 font-mono text-xs text-fg-subtle">
                    {t.qty.replace('{qty}', String(p.qty))}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
