'use client';

import type { SimulateResult } from '@nittcam/core';
import Link from 'next/link';
import { fill } from '../../lib/draft-project';
import type { SimText } from './model';

export interface Finding {
  group: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  file?: string;
  /** 1-based G-code line; 0 or missing = the whole program. */
  line?: number;
}

const RULE_ORDER = [
  'TOOLPATH',
  'POST',
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
  'R6',
  'R7',
  'R8',
  'R9',
  'R10',
  'MODEL',
  'LAYOUT',
  'TOOLS',
  'INPUT',
];

/** Every issue of the export, as one list (the generator's CHECK_FAILED copies are left out). */
export function findings(result: SimulateResult): Finding[] {
  const out: Finding[] = [];
  const ex = result.export;
  for (const i of ex.toolpathIssues) {
    out.push({ group: 'TOOLPATH', severity: i.severity, code: i.code, message: i.message });
  }
  const checked = ex.check !== null;
  for (const i of [...ex.postErrors, ...ex.postWarnings]) {
    if (i.code === 'CHECK_FAILED' && checked) continue;
    out.push({
      group: i.rule ? `R${i.rule}` : 'POST',
      severity: i.severity,
      code: i.code,
      message: i.message,
    });
  }
  for (const v of ex.check?.violations ?? []) {
    out.push({
      group: v.rule,
      severity: v.severity,
      code: v.code,
      message: v.message,
      ...(v.file ? { file: v.file } : {}),
      line: v.line,
    });
  }
  for (const e of result.readErrors) {
    out.push({
      group: 'R9',
      severity: 'error',
      code: e.code,
      message: e.message,
      file: e.file,
      line: e.line,
    });
  }
  return out;
}

export function codeText(t: SimText, code: string): string {
  return (t.codes as Record<string, string>)[code] ?? fill(t.codeFallback, { code });
}

function groupTitle(t: SimText, group: string): string {
  return (t.rules as Record<string, string>)[group] ?? group;
}

function FindingList({ t, items }: { t: SimText; items: readonly Finding[] }) {
  const groups = new Map<string, Finding[]>();
  for (const f of items) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  const ordered = [...groups.entries()].sort(
    (a, b) => RULE_ORDER.indexOf(a[0]) - RULE_ORDER.indexOf(b[0]),
  );
  return (
    <div className="flex flex-col gap-3">
      {ordered.map(([group, list]) => (
        <section
          key={group}
          aria-label={groupTitle(t, group)}
          data-testid="violation-group"
          data-rule={group}
        >
          <h4 className="text-sm font-semibold">{groupTitle(t, group)}</h4>
          <ul className="mt-1 flex flex-col gap-1">
            {list.map((f, i) => (
              <li
                key={`${f.code}-${f.file ?? ''}-${f.line ?? 0}-${i}`}
                data-testid="violation"
                data-code={f.code}
                className="flex flex-col gap-0.5 rounded-md bg-bg/70 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3"
              >
                <span className="shrink-0 font-mono text-xs text-fg-muted">
                  {f.file ? `${f.file} · ` : ''}
                  {f.line && f.line > 0
                    ? fill(t.blocked.line, { line: f.line })
                    : t.blocked.wholeProgram}
                </span>
                <span className="min-w-0">
                  {codeText(t, f.code)}{' '}
                  <span className="block text-xs break-words text-fg-muted">
                    {fill(t.blocked.detail, { message: f.message })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The blocked state (§7.2 rule 9): no simulation, no download, the reasons grouped by rule. */
export function Violations({ t, result }: { t: SimText; result: SimulateResult }) {
  const all = findings(result);
  const errors = all.filter((f) => f.severity === 'error');
  const warnings = all.filter((f) => f.severity === 'warning');
  const stage = result.export.stage;
  return (
    <section
      role="alert"
      aria-labelledby="blocked-title"
      data-testid="sim-blocked"
      className="flex flex-col gap-4 rounded-card border border-danger bg-danger-bg p-4 text-fg sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-danger font-bold text-accent-fg"
        >
          !
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="blocked-title" className="text-xl font-semibold text-danger">
            {t.blocked.title}
          </h2>
          <p className="text-sm">{fill(t.blocked.body, { count: errors.length })}</p>
          <p className="text-sm text-fg-muted">{t.blocked.stage[stage]}</p>
        </div>
      </div>
      <FindingList t={t} items={errors} />
      {warnings.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            {fill(t.blocked.warnings, { count: warnings.length })}
          </summary>
          <div className="mt-2">
            <FindingList t={t} items={warnings} />
          </div>
        </details>
      ) : null}
      <p className="text-sm">
        {t.blocked.machinesHint}{' '}
        <Link href="/makineler" className="font-medium text-accent underline">
          {t.machine.link}
        </Link>
      </p>
    </section>
  );
}

/** Warnings of a passing export (shown under the summary). */
export function WarningList({ t, items }: { t: SimText; items: readonly Finding[] }) {
  return <FindingList t={t} items={items} />;
}
