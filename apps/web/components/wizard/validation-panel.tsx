'use client';

import type { Project, ValidationIssue } from '@nittcam/core';
import { ChevronDown, CircleAlert, CircleCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { createContext, useContext, useId, useState } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { summarizeIssues } from '../../lib/check-state';
import { SimFindingsContext } from '../simulation/sim-findings-context';

type Text = Messages['wizard']['issues'];
type Group = keyof Text['groups'];

const GROUPS: readonly Group[] = ['stock', 'parts', 'layout', 'other'];

/**
 * B53 (CTO #5 / #6): where the panel sits next to the cut list, a part issue's place is a button
 * that scrolls to its row and focuses it. The cut list provides the jump; elsewhere it is plain text.
 */
export const IssueJumpContext = createContext<((partIndex: number) => void) | null>(null);

/** Index of the part an issue path points at, or null. */
export function issuePartIndex(path: string): number | null {
  const m = /^parts\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : null;
}

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
  const jump = useContext(IssueJumpContext);
  const [open, setOpen] = useState(true);
  // T321: the Simülasyon step's toolpath warnings count here too (one source of truth).
  const simWarnings = useContext(SimFindingsContext)?.warnings ?? 0;
  // T321 (usta 2): parts missing from the layout after a quantity change are not a fault of the
  // part: one neutral "yeniden diz" line instead of a red error per row (the export still waits).
  const { listed, errors, warnings, renest, warningCount, clean } = summarizeIssues(
    issues,
    simWarnings,
  );
  const renestNote =
    renest.length > 0 ? (
      <p data-testid="validation-renest" className="flex items-start gap-2 text-sm text-fg-muted">
        <RefreshCw aria-hidden className="mt-0.5 size-4 shrink-0" />
        {fill(t.renest, { count: renest.length })}
      </p>
    ) : null;
  const simNote =
    simWarnings > 0 ? (
      <p
        data-testid="validation-sim-warnings"
        className="flex items-start gap-2 text-sm text-warning-text"
      >
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {fill(t.simWarnings, { count: simWarnings })}
      </p>
    ) : null;
  const bodyId = useId();
  return (
    <section
      aria-labelledby="validation-title"
      data-testid="validation-panel"
      data-errors={errors.length}
      data-warnings={warningCount}
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
          {warningCount > 0 ? (
            <span className="flex items-center gap-1 text-xs font-medium text-warning-text tabular-nums">
              <TriangleAlert aria-hidden className="size-3.5" />
              {warningCount}
            </span>
          ) : null}
          {renest.length > 0 ? (
            <RefreshCw
              aria-hidden
              className="size-3.5 text-fg-muted"
              data-testid="validation-renest-icon"
            />
          ) : null}
          {clean ? <CircleCheck aria-hidden className="size-4 text-success-text" /> : null}
          <ChevronDown
            aria-hidden
            className={`size-4 text-fg-subtle transition-transform duration-(--duration-fast) ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="border-t border-border-subtle px-4 pt-3 pb-4">
        {clean ? (
          <p className="text-sm text-success-text">{t.none}</p>
        ) : listed.length === 0 ? (
          <div className="flex flex-col gap-2">
            {renestNote}
            {simNote}
          </div>
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
                            const partIndex = issuePartIndex(i.path);
                            return (
                              <li
                                key={`${i.code}-${i.path}`}
                                className={`flex gap-2 text-sm ${s.tone}`}
                                data-code={i.code}
                              >
                                {s.icon}
                                <span className="min-w-0">
                                  {place && jump && partIndex !== null ? (
                                    <>
                                      <button
                                        type="button"
                                        data-testid="issue-jump"
                                        data-part={partIndex}
                                        onClick={() => jump(partIndex)}
                                        className="rounded-sm font-medium underline decoration-dotted underline-offset-2 outline-none hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                                      >
                                        {place}
                                      </button>
                                      {': '}
                                    </>
                                  ) : place ? (
                                    <span className="font-medium">{place}: </span>
                                  ) : null}
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
            {renestNote}
            {simNote}
          </div>
        )}
      </div>
    </section>
  );
}
