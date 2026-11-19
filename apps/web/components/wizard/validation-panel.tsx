'use client';

import type { Project, ValidationIssue } from '@nittcam/core';
import { ChevronDown, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';

type Text = Messages['wizard']['issues'];
type Group = keyof Text['groups'];

const GROUPS: readonly Group[] = ['stock', 'parts', 'layout', 'other'];

function groupOf(path: string): Group {
  if (path.startsWith('stock') || path.startsWith('machine')) return 'stock';
  if (path.startsWith('parts[')) return 'parts';
  if (path.startsWith('layout') || path.startsWith('nesting')) return 'layout';
  return 'other';
}

/** Where an issue is, in workshop words: "Satır 3 · Kapak", "Plaka 2". */
function placeOf(t: Text, project: Project, path: string): string | null {
  const part = /^parts\[(\d+)\]/.exec(path);
  if (part) {
    const i = Number(part[1]);
    const name = project.parts[i]?.name ?? '';
    // T270: a cut-out is named by its part and number ("Kapak · İç kesim 3").
    const inner = /^parts\[\d+\]\.inners\[(\d+)\]/.exec(path);
    if (inner && name) return fill(t.innerNamed, { name, k: Number(inner[1]) + 1 });
    // T275: a hole likewise ("Kapak · Delik 3").
    const hole = /^parts\[\d+\]\.holes\[(\d+)\]/.exec(path);
    if (hole && name) return fill(t.holeNamed, { name, k: Number(hole[1]) + 1 });
    // T277: an open line likewise ("Kapak · Çizgi 2").
    const line = /^parts\[\d+\]\.lines\[(\d+)\]/.exec(path);
    if (line && name) return fill(t.lineNamed, { name, k: Number(line[1]) + 1 });
    return name ? fill(t.rowNamed, { n: i + 1, name }) : fill(t.row, { n: i + 1 });
  }
  const sheet = /^layout\.sheets\[(\d+)\]/.exec(path);
  if (sheet) return fill(t.sheet, { n: Number(sheet[1]) + 1 });
  return null;
}

/** Turkish text of a validation code (falls back to "Kontrol <code>"). */
export function issueText(t: Text, code: string): string {
  return code in t.codes ? t.codes[code as keyof Text['codes']] : fill(t.other, { code });
}

/**
 * Warnings panel of the wizard (T023, spec §5.1 "her komuttan sonra kural doğrulaması"): the
 * command layer's `validateProject` result with the selected machine, errors first, grouped by
 * where they are (plate, parts, layout). T109: a collapsible side card with severity icons.
 */
export function ValidationPanel({
  t,
  project,
  issues,
}: {
  t: Text;
  project: Project;
  issues: readonly ValidationIssue[];
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section
      aria-labelledby="validation-title"
      data-testid="validation-panel"
      data-errors={errors.length}
      data-warnings={warnings.length}
      className="flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-xs"
    >
      <h2 id="validation-title" className="text-sm font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left outline-none hover:bg-surface-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex-1 text-fg">{t.title}</span>
          {errors.length > 0 ? (
            <span className="flex items-center gap-1 text-xs font-medium text-danger-text tabular-nums">
              <CircleAlert aria-hidden className="size-3.5" />
              {errors.length}
            </span>
          ) : null}
          {warnings.length > 0 ? (
            <span className="flex items-center gap-1 text-xs font-medium text-warning-text tabular-nums">
              <TriangleAlert aria-hidden className="size-3.5" />
              {warnings.length}
            </span>
          ) : null}
          {issues.length === 0 ? (
            <CircleCheck aria-hidden className="size-4 text-success-text" />
          ) : null}
          <ChevronDown
            aria-hidden
            className={`size-4 text-fg-subtle transition-transform duration-(--duration-fast) ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="border-t border-border-subtle px-4 pt-3 pb-4">
        {issues.length === 0 ? (
          <p className="text-sm text-success-text">{t.none}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {[
              {
                list: errors,
                label: t.errors,
                tone: 'text-danger-text',
                icon: <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />,
              },
              {
                list: warnings,
                label: t.warnings,
                tone: 'text-warning-text',
                icon: <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />,
              },
            ]
              .filter((s) => s.list.length > 0)
              .map((s) => (
                <div key={s.label} className="flex flex-col gap-2">
                  <p className={`text-xs font-semibold ${s.tone}`}>
                    {fill(s.label, { count: s.list.length })}
                  </p>
                  {GROUPS.map((g) => {
                    const inGroup = s.list.filter((i) => groupOf(i.path) === g);
                    if (inGroup.length === 0) return null;
                    return (
                      <div key={g} className="flex flex-col gap-1">
                        <p className="text-xs text-fg-subtle">{t.groups[g]}</p>
                        <ul className="flex flex-col gap-1.5">
                          {inGroup.map((i) => {
                            const place = placeOf(t, project, i.path);
                            return (
                              <li
                                key={`${i.code}-${i.path}`}
                                className={`flex gap-2 text-sm ${s.tone}`}
                                data-code={i.code}
                              >
                                {s.icon}
                                <span className="min-w-0">
                                  {place ? <span className="font-medium">{place}: </span> : null}
                                  {issueText(t, i.code)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
