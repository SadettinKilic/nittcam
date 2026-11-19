'use client';

import type { SimulateResult } from '@nittcam/core';
import Link from 'next/link';
import { fill } from '../../lib/draft-project';
import { itemPlace, machineRelated, onDrawnItem } from '../../lib/part-items';
import type { SimText } from './model';

export interface Finding {
  group: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  file?: string;
  /** Sheet index, when the issue belongs to one sheet. */
  sheet?: number;
  /** 1-based G-code line; 0 or missing = the whole program. */
  line?: number;
  /** The part concerned (toolpath issues). */
  partId?: string;
  /** Its inner contour (0-based), for an issue about a cut-out (T270). */
  inner?: number;
  /** Its hole (0-based), for an issue about a hole (T275). */
  hole?: number;
}

/** Part names for the place of a cut-out issue, and the way to the drawing board (T270). */
export interface PartLinks {
  parts?: readonly { id: string; name: string }[];
  onOpenPart?: ((partId: string, hole?: number) => void) | undefined;
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
  const cutOuts = new Set<string>();
  for (const i of ex.toolpathIssues) {
    // T270: one line per cut-out, not one per copy of the part.
    if (i.inner !== undefined || i.hole !== undefined) {
      const key = `${i.code}/${i.partId ?? ''}/${i.inner ?? ''}/${i.hole ?? ''}`;
      if (cutOuts.has(key)) continue;
      cutOuts.add(key);
    }
    out.push({
      group: 'TOOLPATH',
      severity: i.severity,
      code: i.code,
      message: i.message,
      ...(i.sheet !== undefined ? { sheet: i.sheet } : {}),
      ...(i.partId !== null ? { partId: i.partId } : {}),
      ...(i.inner !== undefined ? { inner: i.inner } : {}),
      ...(i.hole !== undefined ? { hole: i.hole } : {}),
    });
  }
  const checked = ex.check !== null;
  for (const i of [...ex.postErrors, ...ex.postWarnings]) {
    if (i.code === 'CHECK_FAILED' && checked) continue;
    out.push({
      group: i.rule ? `R${i.rule}` : 'POST',
      severity: i.severity,
      code: i.code,
      message: i.message,
      ...(i.sheet !== undefined ? { sheet: i.sheet } : {}),
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

export function knownCode(t: SimText, code: string): boolean {
  return code in (t.codes as Record<string, string>);
}

export function codeText(t: SimText, code: string): string {
  return (t.codes as Record<string, string>)[code] ?? fill(t.codeFallback, { code });
}

function groupTitle(t: SimText, group: string): string {
  return (t.rules as Record<string, string>)[group] ?? group;
}

/** "Kapak · İç kesim 3" (T270) / "Kapak · Delik 3" (T275) for an issue about a drawn item. */
function innerPlace(t: SimText, f: Finding, links: PartLinks): string | null {
  return itemPlace(f, links.parts, t.blocked, fill);
}

function FindingList({
  t,
  items,
  links = {},
}: {
  t: SimText;
  items: readonly Finding[];
  links?: PartLinks;
}) {
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
                className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3"
              >
                {innerPlace(t, f, links) ? (
                  <span className="shrink-0 text-xs font-medium" data-testid="violation-place">
                    {innerPlace(t, f, links)}
                  </span>
                ) : (
                  <span className="shrink-0 font-mono text-xs text-fg-muted">
                    {f.sheet !== undefined && !f.file
                      ? `${fill(t.sheetTab, { n: f.sheet + 1 })} · `
                      : ''}
                    {f.file ? `${f.file} · ` : ''}
                    {f.line && f.line > 0
                      ? fill(t.blocked.line, { line: f.line })
                      : t.blocked.wholeProgram}
                  </span>
                )}
                <span className="min-w-0">
                  {codeText(t, f.code)}
                  {/* D-045: the engine's English sentence only for a code without Turkish text. */}
                  {knownCode(t, f.code) ? null : (
                    <span className="block text-xs break-words text-fg-muted">
                      {fill(t.blocked.detail, { message: f.message })}
                    </span>
                  )}
                </span>
                {onDrawnItem(f) && links.onOpenPart ? (
                  <button
                    type="button"
                    data-testid="violation-open-part"
                    onClick={() => links.onOpenPart?.(f.partId as string, f.hole)}
                    className="shrink-0 rounded-sm text-sm font-medium text-accent-text underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:ml-auto"
                  >
                    {t.blocked.openPart}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The blocked state (§7.2 rule 9): no simulation, no download, the reasons grouped by rule. */
export function Violations({
  t,
  result,
  parts,
  onOpenPart,
}: { t: SimText; result: SimulateResult } & PartLinks) {
  const links: PartLinks = { ...(parts ? { parts } : {}), onOpenPart };
  const all = findings(result);
  const errors = all.filter((f) => f.severity === 'error');
  const warnings = all.filter((f) => f.severity === 'warning');
  const stage = result.export.stage;
  // T270 / T275: the Makineler hint only for an error whose fix may be on the machine.
  const machineHint = errors.some(machineRelated);
  return (
    <section
      role="alert"
      aria-labelledby="blocked-title"
      data-testid="sim-blocked"
      className="flex flex-col gap-4 rounded-xl border border-danger-border bg-danger-subtle p-4 text-fg sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-danger font-bold text-danger-fg"
        >
          !
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="blocked-title" className="text-base font-semibold text-danger-text">
            {t.blocked.title}
          </h2>
          <p className="text-sm">{fill(t.blocked.body, { count: errors.length })}</p>
          <p className="text-sm text-fg-muted">{t.blocked.stage[stage]}</p>
        </div>
      </div>
      <FindingList t={t} items={errors} links={links} />
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
      {machineHint ? (
        <p className="text-sm">
          {t.blocked.machinesHint}{' '}
          <Link href="/makineler" className="rounded-sm font-medium text-accent-text underline">
            {t.machine.link}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** Warnings of a passing export (shown under the summary). */
export function WarningList({ t, items }: { t: SimText; items: readonly Finding[] }) {
  return <FindingList t={t} items={items} />;
}
