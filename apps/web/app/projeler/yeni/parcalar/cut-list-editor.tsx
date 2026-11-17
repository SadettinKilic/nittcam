'use client';

import {
  CommandStack,
  parseCutListNumber,
  type CutListPartInput,
  type Part,
  type ValidationIssue,
} from '@nittcam/core';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { draftProject, draftToolDiameter, fill, newPartId } from '../../../../lib/draft-project';
import type { Messages } from '../../../../lib/messages';
import { useNestingWorker } from '../../../../lib/use-nesting-worker';
import { LayoutView, type LockRequest } from '../../../../components/layout-view/layout-view';
import { NestingPanel } from './nesting-panel';
import { PastePanel } from './paste-panel';
import { buttonClass } from './ui';

type Text = Messages['cutList'];
type LayoutText = Messages['layout'];
type EdgeKey = 'top' | 'right' | 'bottom' | 'left';

/** Grid order of the edge band columns: Üst, Alt, Sol, Sağ (T011b). */
const EDGES: readonly EdgeKey[] = ['top', 'bottom', 'left', 'right'];

const inputClass =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-bg';

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
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
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

type Run = (name: string, params: unknown) => boolean;

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
    <tr className="align-top">
      <td className="px-2 py-2 text-right text-fg-muted tabular-nums">{n}</td>
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
          <p key={`${issue.code}-${issue.path}`} className="mt-1 text-xs font-medium text-warn">
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
        <input
          id={cellId(index, 'grain')}
          type="checkbox"
          aria-label={label(t.columns.grain)}
          className="mt-2 size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          checked={part.grainLock}
          onChange={(e) => void update({ grainLock: e.target.checked })}
        />
      </td>
      {EDGES.map((edge) => (
        <td key={edge} className="px-0.5 py-1">
          <Cell
            {...cellProps}
            col={`edge-${edge}`}
            numeric
            className="w-14 px-1.5"
            label={fill(t.edgeLabel, { n, edge: t.edge[edge] })}
            value={formatInput(part.edgeBand[edge])}
            current={part.edgeBand[edge]}
            validate={band(t)}
            onCommit={(v) => update({ edgeBand: { [edge]: v } })}
          />
        </td>
      ))}
      <td className="px-1 py-1">
        <div className="flex gap-1">
          <button
            type="button"
            aria-label={fill(t.rowAction, { action: t.duplicate, n })}
            className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
            onClick={() => void run('duplicatePart', { id: part.id, newId: newPartId() })}
          >
            {t.duplicate}
          </button>
          <button
            type="button"
            aria-label={fill(t.rowAction, { action: t.remove, n })}
            className={`${buttonClass} border border-border bg-bg text-danger hover:bg-danger-bg`}
            onClick={() => void run('removePart', { id: part.id })}
          >
            {t.remove}
          </button>
        </div>
      </td>
    </tr>
  );
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio'
  );
}

export function CutListEditor({ t, layoutText }: { t: Text; layoutText: LayoutText }) {
  // The validation context carries the nesting tool diameter, so LOCKED_PLACEMENT_INVALID checks
  // the same spacing the placer keeps (D-020).
  const [stack] = useState(() => {
    const start = draftProject();
    return new CommandStack(start, { toolDiameter: draftToolDiameter(start) });
  });
  const [, setVersion] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const runNesting = useNestingWorker();
  const [nesting, setNesting] = useState(false);
  const [nestMessage, setNestMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(
    null,
  );
  const pasteButton = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const run: Run = useCallback(
    (name, params) => {
      const result = stack.execute(name, params, { actor: 'user', at: new Date().toISOString() });
      if (result.ok) refresh();
      return result.ok;
    },
    [stack, refresh],
  );

  const undo = useCallback(() => {
    if (stack.undo()) refresh();
  }, [stack, refresh]);
  const redo = useCallback(() => {
    if (stack.redo()) refresh();
  }, [stack, refresh]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  useEffect(() => {
    if (focusNext.current) {
      document.getElementById(focusNext.current)?.focus();
      focusNext.current = null;
    }
  });

  const project = stack.project;
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

  async function nest() {
    const base = stack.project;
    setNesting(true);
    setNestMessage(null);
    try {
      const res = await runNesting(base, draftToolDiameter(base));
      if (!res.ok) {
        if (res.error !== 'terminated') {
          setNestMessage({ kind: 'error', text: fill(t.nesting.failed, { error: res.error }) });
        }
        return;
      }
      const result = stack.executeApplied(
        'runNesting',
        res.applied,
        { actor: 'user', at: new Date().toISOString() },
        base,
      );
      if (!result.ok) {
        setNestMessage(
          result.error.code === 'STALE_BASE'
            ? { kind: 'error', text: t.nesting.stale }
            : { kind: 'error', text: fill(t.nesting.failed, { error: result.error.message }) },
        );
      } else if (!result.changed) {
        setNestMessage({ kind: 'info', text: t.nesting.unchanged });
      }
      refresh();
    } finally {
      setNesting(false);
    }
  }

  const issuesOf = (index: number) =>
    stack.issues.filter(
      (i) => i.path === `parts[${index}]` || i.path.startsWith(`parts[${index}].`),
    );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-fg-muted">{t.subtitle}</p>
        <p className="text-sm text-fg-muted">{t.draftNote}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={pasteButton}
          type="button"
          aria-expanded={pasteOpen}
          aria-controls="paste-panel"
          onClick={() => {
            setNotice(null);
            setPasteOpen((o) => !o);
          }}
          className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
        >
          {t.pasteOpen}
        </button>
        <button
          type="button"
          onClick={addRow}
          className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
        >
          {t.addRow}
        </button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <button
          type="button"
          onClick={undo}
          disabled={!stack.canUndo}
          aria-keyshortcuts="Control+Z"
          className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
        >
          {t.undo}
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!stack.canRedo}
          aria-keyshortcuts="Control+Y"
          className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
        >
          {t.redo}
        </button>
      </div>

      <div aria-live="polite">
        {notice ? (
          <p role="status" className="rounded-lg bg-ok-bg p-3 text-sm text-ok">
            {notice}
          </p>
        ) : null}
      </div>

      {pasteOpen ? (
        <PastePanel t={t.paste} onApply={applyPaste} onCancel={() => setPasteOpen(false)} />
      ) : null}

      <section aria-labelledby="cut-list-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cut-list-title" className="text-xl font-semibold">
            {t.tableLabel}
          </h2>
          <p className="text-sm text-fg-muted" data-testid="cut-list-count">
            {fill(t.count, { rows: parts.length, pieces })}
          </p>
        </div>
        {parts.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-6 text-center text-fg-muted">
            {t.empty}
          </p>
        ) : (
          <div className="relative max-w-full overflow-x-auto rounded-card border border-border">
            <table className="w-full text-left text-sm" aria-labelledby="cut-list-title">
              <thead className="bg-sidebar text-fg-muted">
                <tr>
                  <th scope="col" rowSpan={2} className="px-2 py-2 text-right font-medium">
                    {t.columns.index}
                  </th>
                  <th scope="col" rowSpan={2} className="px-2 py-2 font-medium">
                    {t.columns.name}
                  </th>
                  <th scope="col" rowSpan={2} className="px-2 py-2 font-medium">
                    {t.columns.w}
                  </th>
                  <th scope="col" rowSpan={2} className="px-2 py-2 font-medium">
                    {t.columns.h}
                  </th>
                  <th scope="col" rowSpan={2} className="px-2 py-2 font-medium">
                    {t.columns.qty}
                  </th>
                  <th scope="col" rowSpan={2} className="px-2 py-2 text-center font-medium">
                    {t.columns.grain}
                  </th>
                  <th
                    scope="colgroup"
                    colSpan={EDGES.length}
                    className="px-1 pt-2 pb-0.5 text-center font-medium whitespace-nowrap"
                  >
                    {t.columns.edgeGroup}
                  </th>
                  <th scope="col" rowSpan={2} className="px-2 py-2 font-medium">
                    {t.columns.actions}
                  </th>
                </tr>
                <tr>
                  {EDGES.map((e) => (
                    <th
                      key={e}
                      scope="col"
                      className="px-0.5 pb-2 text-center text-xs font-normal"
                      data-testid={`edge-col-${e}`}
                    >
                      {t.edge[e]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
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
        <p className="text-xs text-fg-muted">{t.shortcuts}</p>
      </section>

      <NestingPanel
        t={t.nesting}
        project={project}
        toolDiameter={draftToolDiameter(project)}
        running={nesting}
        message={nestMessage}
        onRun={() => void nest()}
      />

      {project.layout.sheets.length > 0 ? (
        <LayoutView
          t={layoutText}
          project={project}
          toolDiameter={draftToolDiameter(project)}
          issues={stack.issues}
          onLock={(req: LockRequest) => run('lockPlacement', req)}
          onRenest={() => void nest()}
          renesting={nesting}
        />
      ) : null}
    </main>
  );
}
