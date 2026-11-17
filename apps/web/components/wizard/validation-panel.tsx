'use client';

import type { Project, ValidationIssue } from '@nittcam/core';
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
 * where they are (plate, parts, layout).
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
  return (
    <section
      aria-labelledby="validation-title"
      data-testid="validation-panel"
      data-errors={errors.length}
      data-warnings={warnings.length}
      className="flex flex-col gap-2 rounded-card border border-border p-3"
    >
      <h2 id="validation-title" className="text-sm font-semibold">
        {t.title}
      </h2>
      {issues.length === 0 ? (
        <p className="text-sm text-ok">{t.none}</p>
      ) : (
        [
          { list: errors, label: t.errors, tone: 'text-danger', bg: 'bg-danger-bg' },
          { list: warnings, label: t.warnings, tone: 'text-warn', bg: 'bg-warn-bg' },
        ]
          .filter((s) => s.list.length > 0)
          .map((s) => (
            <div key={s.label} className={`flex flex-col gap-1.5 rounded-lg p-2 ${s.bg}`}>
              <p className={`text-xs font-semibold ${s.tone}`}>
                {fill(s.label, { count: s.list.length })}
              </p>
              {GROUPS.map((g) => {
                const inGroup = s.list.filter((i) => groupOf(i.path) === g);
                if (inGroup.length === 0) return null;
                return (
                  <div key={g} className="flex flex-col gap-0.5">
                    <p className="text-xs text-fg-muted">{t.groups[g]}</p>
                    <ul className="flex flex-col gap-0.5">
                      {inGroup.map((i) => {
                        const place = placeOf(t, project, i.path);
                        return (
                          <li
                            key={`${i.code}-${i.path}`}
                            className={`text-sm ${s.tone}`}
                            data-code={i.code}
                          >
                            {place ? <span className="font-medium">{place}: </span> : null}
                            {issueText(t, i.code)}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))
      )}
    </section>
  );
}
