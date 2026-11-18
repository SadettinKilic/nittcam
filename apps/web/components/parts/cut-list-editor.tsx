'use client';

import {
  parseCutListNumber,
  type CutListPartInput,
  type Project,
  type Part,
  type ValidationIssue,
} from '@nittcam/core';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fill, newPartId } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import { PastePanel } from './paste-panel';
import { Button, Checkbox, IconButton, Tooltip } from '@nittcam/ui';
import {
  CircleCheck,
  ClipboardPaste,
  Copy,
  Plus,
  Rows3,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

type Text = Messages['cutList'];
type EdgeKey = 'top' | 'right' | 'bottom' | 'left';

/** Grid order of the edge band columns: Üst, Alt, Sol, Sağ (T011b). */
const EDGES: readonly EdgeKey[] = ['top', 'bottom', 'left', 'right'];

/** Spreadsheet-like cell input: quiet until hover or focus (T109 restyle; full grid UX is M3). */
const inputClass =
  'h-control-sm w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-fg transition-colors duration-(--duration-fast) outline-none hover:border-border-strong focus-visible:outline-solid focus-visible:border-focus focus-visible:bg-surface focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-focus/25 aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-subtle';

/** Numbers in inputs: Turkish decimal comma, no grouping. */
function formatInput(v: number): string {
  return String(v).replace('.', ',');
}

/** DOM id of a grid input, used for Enter → next row. */
function cellId(row: number, col: string): string {
  return `cl-${row}-${col}`;
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

interface CellProps<T> {
  row: number;
  col: string;
  label: string;
  /** Shown text of the current project value. */
  value: string;
  /** The current project value; committing an equal value runs no command. */
  current: T;
  numeric?: boolean;
  className?: string;
  validate: (text: string) => Validated<T>;
  /** Runs the command; false when it was rejected. */
  onCommit: (value: T) => boolean;
  rejected: string;
}

/**
 * One editable grid cell. Typing only changes local text; the command runs on Enter or when the
 * cell loses focus, so each edit is one undo step. Esc drops the typed text.
 */
function Cell<T>({
  row,
  col,
  label,
  value,
  current,
  numeric,
  className,
  validate,
  onCommit,
  rejected,
}: CellProps<T>) {
  const [draft, setDraftState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The pending text, read synchronously: Enter commits and moves focus, and the blur that follows
  // must see that the edit is already committed (a state value would still be the stale draft).
  const pending = useRef<string | null>(null);
  const id = cellId(row, col);

  function setDraft(text: string | null) {
    pending.current = text;
    setDraftState(text);
  }

  /** Idempotent: commits each edit at most once and never runs a command for an unchanged value. */
  function commit(): boolean {
    const text = pending.current;
    if (text === null) return true;
    if (text === value) {
      setDraft(null);
      return true;
    }
    const v = validate(text);
    if (!v.ok) {
      setError(v.error);
      return false;
    }
    if (Object.is(v.value, current)) {
      setDraft(null);
      setError(null);
      return true;
    }
    if (onCommit(v.value)) {
      setDraft(null);
      setError(null);
      return true;
    }
    setError(rejected);
    return false;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (commit()) document.getElementById(cellId(row + 1, col))?.focus();
    } else if (e.key === 'Escape') {
      setDraft(null);
      setError(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        type="text"
        inputMode={numeric ? 'decimal' : undefined}
        autoComplete="off"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClass} ${numeric ? 'text-right tabular-nums' : ''} ${className ?? ''}`}
        value={draft ?? value}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <p id={`${id}-error`} className="px-2 text-xs font-medium text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function positive(t: Text) {
  return (text: string): Validated<number> => {
    const n = parseCutListNumber(text, 'comma');
    if (n === null) return { ok: false, error: t.errors.number };
    if (n <= 0) return { ok: false, error: t.errors.positive };
    return { ok: true, value: n };
  };
}

function quantity(t: Text) {
  return (text: string): Validated<number> => {
    const n = parseCutListNumber(text, 'comma');
    if (n === null || !Number.isInteger(n) || n < 1) return { ok: false, error: t.errors.qty };
    return { ok: true, value: n };
  };
}

function band(t: Text) {
  return (text: string): Validated<number> => {
    if (text.trim() === '') return { ok: true, value: 0 };
    const n = parseCutListNumber(text, 'comma');
    if (n === null || n < 0) return { ok: false, error: t.errors.band };
    return { ok: true, value: n };
  };
}

export type Run = (name: string, params: unknown) => boolean;

function PartRow({
  t,
  part,
  index,
  issues,
  run,
}: {
  t: Text;
  part: Part;
  index: number;
  issues: readonly ValidationIssue[];
  run: Run;
}) {
  const n = index + 1;
  const label = (column: string) => fill(t.cellLabel, { n, column });
  const update = (fields: Record<string, unknown>) => run('updatePart', { id: part.id, ...fields });
  const rect = part.kind === 'rect' ? part : null;
  const cellProps = { row: index, rejected: t.errors.rejected };
  return (
    <tr className="align-top transition-colors duration-(--duration-fast) hover:bg-surface-subtle">
      <td className="px-3 py-2.5 text-right text-xs text-fg-subtle tabular-nums">{n}</td>
      <td className="min-w-40 px-1 py-1">
        <Cell
          {...cellProps}
          col="name"
          label={label(t.columns.name)}
          value={part.name}
          current={part.name}
          validate={(text) => ({ ok: true, value: text.trim() })}
          onCommit={(name) => update({ name })}
        />
        {issues.map((issue) => (
          <p
            key={`${issue.code}-${issue.path}`}
            className="mt-1 flex items-center gap-1 px-2 text-xs font-medium text-warning-text"
          >
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            {issue.code in t.issues ? t.issues[issue.code as keyof Text['issues']] : t.issues.other}
          </p>
        ))}
      </td>
      {(['w', 'h'] as const).map((key) => (
        <td key={key} className="min-w-24 px-1 py-1">
          {rect ? (
            <Cell
              {...cellProps}
              col={key}
              numeric
              label={label(t.columns[key])}
              value={formatInput(rect.params[key])}
              current={rect.params[key]}
              validate={positive(t)}
              onCommit={(v) => update({ params: { [key]: v } })}
            />
          ) : (
            <span className="text-fg-muted">–</span>
          )}
        </td>
      ))}
      <td className="min-w-20 px-1 py-1">
        <Cell
          {...cellProps}
          col="qty"
          numeric
          label={label(t.columns.qty)}
          value={String(part.qty)}
          current={part.qty}
          validate={quantity(t)}
          onCommit={(qty) => update({ qty })}
        />
      </td>
      <td className="px-1 py-1 text-center">
        <Checkbox
          id={cellId(index, 'grain')}
          aria-label={label(t.columns.grain)}
          className="mt-2"
          checked={part.grain.mode === 'fixed'}
          onCheckedChange={(v) => void update({ grainLock: v === true })}
        />
      </td>
      {EDGES.map((edge) => (
        <td key={edge} className="min-w-16 px-0.5 py-1">
          <Cell
            {...cellProps}
            col={`edge-${edge}`}
            numeric
            className="px-1.5"
            label={fill(t.edgeLabel, { n, edge: t.edge[edge] })}
            value={formatInput(part.edgeBand[edge])}
            current={part.edgeBand[edge]}
            validate={band(t)}
            onCommit={(v) => update({ edgeBand: { [edge]: v } })}
          />
        </td>
      ))}
      <td className="px-1 py-1">
        <div className="flex justify-end gap-0.5">
          <Tooltip content={t.duplicate}>
            <IconButton
              size="sm"
              aria-label={fill(t.rowAction, { action: t.duplicate, n })}
              onClick={() => void run('duplicatePart', { id: part.id, newId: newPartId() })}
            >
              <Copy aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip content={t.remove}>
            <IconButton
              size="sm"
              aria-label={fill(t.rowAction, { action: t.remove, n })}
              className="hover:bg-danger-subtle hover:text-danger-text"
              onClick={() => void run('removePart', { id: part.id })}
            >
              <Trash2 aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}

/**
 * The cut-list editor of the wizard's Parçalar step (T011, T011b; spec §3.6 step 2, §4.1): the
 * Excel/CSV paste and the editable grid. It never changes the project itself: every edit runs a
 * command through `run` (command layer), so undo/redo, autosave and validation see it.
 */
export function CutListEditor({
  t,
  project,
  issues,
  run,
}: {
  t: Text;
  project: Project;
  issues: readonly ValidationIssue[];
  run: Run;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusNext.current) {
      document.getElementById(focusNext.current)?.focus();
      focusNext.current = null;
    }
  });

  const parts = project.parts;
  const pieces = parts.reduce((sum, p) => sum + p.qty, 0);

  function addRow() {
    setNotice(null);
    const ok = run('addPart', {
      id: newPartId(),
      name: fill(t.defaultName, { n: parts.length + 1 }),
      params: { w: 100, h: 100, r: 0 },
    });
    if (ok) focusNext.current = cellId(parts.length, 'name');
  }

  function applyPaste(rows: CutListPartInput[]): boolean {
    const ok = run('importCutList', { parts: rows });
    if (ok) {
      setPasteOpen(false);
      setNotice(fill(t.paste.applied, { count: rows.length }));
      requestAnimationFrame(() => pasteButton.current?.focus());
    }
    return ok;
  }

  const issuesOf = (index: number) =>
    issues.filter((i) => i.path === `parts[${index}]` || i.path.startsWith(`parts[${index}].`));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div aria-live="polite">
        {notice ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border border-success-border bg-success-subtle px-3 py-2.5 text-sm text-success-text"
          >
            <CircleCheck aria-hidden className="size-4 shrink-0" />
            {notice}
          </p>
        ) : null}
      </div>

      {pasteOpen ? (
        <PastePanel t={t.paste} onApply={applyPaste} onCancel={() => setPasteOpen(false)} />
      ) : null}

      <section
        aria-labelledby="cut-list-title"
        className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="cut-list-title" className="text-base font-semibold tracking-tight text-fg">
              {t.tableLabel}
            </h2>
            <p className="text-sm text-fg-muted tabular-nums" data-testid="cut-list-count">
              {fill(t.count, { rows: parts.length, pieces })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus aria-hidden />
              {t.addRow}
            </Button>
            <Button
              ref={pasteButton}
              size="sm"
              aria-expanded={pasteOpen}
              aria-controls="paste-panel"
              onClick={() => {
                setNotice(null);
                setPasteOpen((o) => !o);
              }}
            >
              <ClipboardPaste aria-hidden />
              {t.pasteOpen}
            </Button>
          </div>
        </div>
        {parts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-subtle text-fg-muted">
              <Rows3 aria-hidden className="size-5" />
            </span>
            <p className="max-w-sm text-sm text-fg-muted">{t.empty}</p>
          </div>
        ) : (
          <div className="relative max-w-full overflow-x-auto">
            <table className="w-full text-left text-sm" aria-labelledby="cut-list-title">
              <thead className="border-b border-border bg-surface-subtle text-fg-muted">
                <tr>
                  <th
                    scope="col"
                    rowSpan={2}
                    className="px-3 py-2.5 text-xs font-medium text-right"
                  >
                    {t.columns.index}
                  </th>
                  <th scope="col" rowSpan={2} className="px-3 py-2.5 text-xs font-medium">
                    {t.columns.name}
                  </th>
                  <th
                    scope="col"
                    rowSpan={2}
                    className="px-3 py-2.5 text-xs font-medium text-right"
                  >
                    {t.columns.w}
                  </th>
                  <th
                    scope="col"
                    rowSpan={2}
                    className="px-3 py-2.5 text-xs font-medium text-right"
                  >
                    {t.columns.h}
                  </th>
                  <th
                    scope="col"
                    rowSpan={2}
                    className="px-3 py-2.5 text-xs font-medium text-right"
                  >
                    {t.columns.qty}
                  </th>
                  <th
                    scope="col"
                    rowSpan={2}
                    className="px-3 py-2.5 text-xs font-medium text-center"
                  >
                    {t.columns.grain}
                  </th>
                  <th
                    scope="colgroup"
                    colSpan={EDGES.length}
                    className="px-1 pt-2.5 pb-0.5 text-center text-xs font-medium whitespace-nowrap"
                  >
                    {t.columns.edgeGroup}
                  </th>
                  <th
                    scope="col"
                    rowSpan={2}
                    className="px-3 py-2.5 text-xs font-medium text-right"
                  >
                    {t.columns.actions}
                  </th>
                </tr>
                <tr>
                  {EDGES.map((e) => (
                    <th
                      key={e}
                      scope="col"
                      className="px-0.5 pb-2 text-center text-2xs font-normal text-fg-subtle"
                      data-testid={`edge-col-${e}`}
                    >
                      {t.edge[e]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {parts.map((part, index) => (
                  <PartRow
                    key={part.id}
                    t={t}
                    part={part}
                    index={index}
                    issues={issuesOf(index)}
                    run={run}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-subtle sm:px-5">
          {t.shortcuts}
        </p>
      </section>
    </div>
  );
}
