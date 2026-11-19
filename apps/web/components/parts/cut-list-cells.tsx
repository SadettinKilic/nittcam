'use client';

import type { Part } from '@nittcam/core';
import {
  Button,
  GrainArrow,
  GrainDial,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Switch,
  buttonVariants,
  cn,
  formatNumberTr,
  notify,
} from '@nittcam/ui';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  EDGES,
  bandedEdges,
  cellId,
  formatInput,
  validateBand,
  type EdgeKey,
  type NavDirection,
  type Validated,
} from '../../lib/cut-list-grid';
import { fill } from '../../lib/draft-project';
import { grainDialLabels } from '../../lib/grain-labels';
import type { Messages } from '../../lib/messages';

export type Text = Messages['cutList'];
export type Run = (name: string, params: unknown) => boolean;
/** Moves focus from a cell; `enter` = the move came from Enter (may add a row). */
export type Navigate = (row: number, col: string, dir: NavDirection, enter?: boolean) => void;

/** Spreadsheet-like cell input: quiet until hover or focus; 32 px inside a 36 px row (T118). */
const inputClass =
  'h-control-sm w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm text-fg transition-colors duration-(--duration-fast) outline-none hover:border-border-strong focus-visible:outline-solid focus-visible:border-focus focus-visible:bg-surface focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-focus/25 aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-subtle';

/** Keys that leave a navigation-mode cell (arrows only while not editing the text). */
function navKey(e: KeyboardEvent, editing: boolean): NavDirection | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case 'Tab':
      return e.shiftKey ? 'prev' : 'next';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return editing ? null : 'left';
    case 'ArrowRight':
      return editing ? null : 'right';
    default:
      return null;
  }
}

/** Arrow / Tab handling for non-text cells (grain, band, row menu): always navigation mode. */
export function onButtonNav(e: KeyboardEvent, row: number, col: string, navigate: Navigate): void {
  const dir = navKey(e, false);
  if (!dir) return;
  e.preventDefault();
  navigate(row, col, dir);
}

interface TextCellProps<T> {
  row: number;
  col: string;
  /** DOM id; defaults to the grid cell id. */
  id?: string | undefined;
  label: string;
  /** Shown text of the current project value. */
  value: string;
  /** The current project value; committing an equal value runs no command. */
  current: T;
  numeric?: boolean | undefined;
  className?: string | undefined;
  validate: (text: string) => Validated<T>;
  /** Runs the command; false when it was rejected. */
  onCommit: (value: T) => boolean;
  rejected: string;
  navigate?: Navigate | undefined;
  maxLength?: number | undefined;
}

/**
 * One editable cell (T118). Focus by keyboard selects the text in navigation mode: arrows move
 * between cells, typing replaces the value, Enter or F2 starts editing (caret at the end). A click
 * edits in place. Enter commits and moves down, Tab / Shift+Tab commit and move sideways, Esc
 * drops the typed text. Each commit is one command, so one undo step.
 */
export function TextCell<T>({
  row,
  col,
  id: idProp,
  label,
  value,
  current,
  numeric,
  className,
  validate,
  onCommit,
  rejected,
  navigate,
  maxLength,
}: TextCellProps<T>) {
  const [draft, setDraftState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The pending text, read synchronously: Enter commits and moves focus, and the blur that follows
  // must see that the edit is already committed (a state value would still be the stale draft).
  const pending = useRef<string | null>(null);
  const editing = useRef(false);
  const pointer = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Esc restores the project value; select it after that render so typing replaces it again.
  const reselect = useRef(false);
  useLayoutEffect(() => {
    if (reselect.current) {
      reselect.current = false;
      if (document.activeElement === inputRef.current) inputRef.current?.select();
    }
  });
  const id = idProp ?? cellId(row, col);

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

  // A row that scrolls out of the virtual window unmounts its inputs without a blur: commit the
  // typed text then, so an edit is never dropped (B7 r2). Invalid text has nowhere to show its
  // error once the cell is gone, so it is dropped as Esc would.
  const commitLatest = useRef(commit);
  useLayoutEffect(() => {
    commitLatest.current = commit;
  });
  useEffect(
    () => () => {
      if (pending.current !== null) commitLatest.current();
    },
    [],
  );

  function startEditing(input: HTMLInputElement) {
    editing.current = true;
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!editing.current && pending.current === null && navigate) {
        startEditing(input);
        return;
      }
      if (commit()) {
        editing.current = false;
        if (navigate) navigate(row, col, 'down', true);
        else input.select();
      }
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      startEditing(input);
      return;
    }
    if (e.key === 'Escape') {
      if (pending.current !== null || error) e.stopPropagation();
      setDraft(null);
      setError(null);
      editing.current = false;
      reselect.current = true;
      input.select();
      return;
    }
    if (!navigate) return;
    const dir = navKey(e, editing.current);
    if (!dir) return;
    e.preventDefault();
    if (commit()) {
      editing.current = false;
      navigate(row, col, dir);
    }
  }

  const errorId = `${id}-error`;
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode={numeric ? 'decimal' : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={maxLength}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(inputClass, numeric && 'text-right tabular-nums', className)}
        value={draft ?? value}
        onMouseDown={() => {
          pointer.current = true;
        }}
        onFocus={(e) => {
          if (pointer.current) {
            pointer.current = false;
            editing.current = true;
          } else {
            editing.current = false;
            e.currentTarget.select();
          }
        }}
        onInput={() => {
          // Any typing (even a value equal to the current one) switches to edit mode.
          editing.current = true;
        }}
        onChange={(e) => {
          editing.current = true;
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={() => {
          editing.current = false;
          void commit();
        }}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="absolute top-full left-0 z-20 mt-1 w-max max-w-56 rounded-md bg-danger px-2 py-1 text-xs font-medium text-danger-fg shadow-md"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A cell button whose popover mounts only when it first opens (T118 perf): a virtual grid mounts
 * rows while scrolling, and a Radix popover root per row made each row too heavy. The button stays
 * the same element (anchored with `virtualRef`), so focus and the grid's ids never move.
 */
function PopoverButton({
  content,
  contentClassName,
  onOpenChange,
  onClick,
  ...button
}: Omit<ComponentProps<'button'>, 'type' | 'content'> & {
  content: () => ReactNode;
  contentClassName: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpenState] = useState(false);
  const [mounted, setMounted] = useState(false);
  // A press outside closes without taking focus back (as a Radix trigger does).
  const outside = useRef(false);
  function setOpen(next: boolean) {
    if (next) setMounted(true);
    setOpenState(next);
    onOpenChange?.(next);
  }
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-state={open ? 'open' : 'closed'}
        {...button}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) setOpen(!open);
        }}
      />
      {mounted ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor virtualRef={ref as { current: HTMLButtonElement }} />
          <PopoverContent
            className={contentClassName}
            data-density="compact"
            onInteractOutside={(e) => {
              // The button toggles itself on click; a press on it is not "outside".
              if (ref.current?.contains(e.target as Node)) e.preventDefault();
              else outside.current = true;
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (!outside.current) ref.current?.focus();
              outside.current = false;
            }}
          >
            {content()}
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}

/**
 * Grain cell of a row (T116, D-034): mini arrow + angle; opens a popover with the GrainDial, the
 * fixed/free switch and "apply to all parts" (one `setPartsGrain` command, one undo step).
 * Changing the angle makes the grain fixed: an angle only matters for a fixed grain.
 */
export function GrainCell({
  t,
  part,
  row,
  allIds,
  run,
  navigate,
}: {
  t: Text;
  part: Part;
  row: number;
  /** Ids of all parts, read when the popover opens (rows are memoised). */
  allIds: () => readonly string[];
  run: Run;
  navigate?: Navigate | undefined;
}) {
  const g = t.grainCell;
  const n = row + 1;
  const fixed = part.grain.mode === 'fixed';
  const [live, setLive] = useState<number | null>(null);
  const angle = live ?? part.grain.angle;
  const deg = `${formatNumberTr(angle, { maxDecimals: 1 })}°`;
  const switchId = `grain-fixed-${part.id}`;
  return (
    <PopoverButton
      onOpenChange={() => setLive(null)}
      contentClassName="flex w-80 flex-col gap-3"
      id={cellId(row, 'grain')}
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        'h-control-sm gap-1 px-1.5',
        // Angles are figures (tabular); "Serbest" is a word in the UI font.
        fixed ? 'font-mono text-fg tabular-nums' : 'text-fg-subtle',
      )}
      aria-label={fill(g.edit, { n, angle: fixed ? deg : g.free })}
      data-testid={`grain-cell-${n}`}
      data-mode={part.grain.mode}
      data-angle={part.grain.angle}
      onKeyDown={navigate ? (e) => onButtonNav(e, row, 'grain', navigate) : undefined}
      content={() => (
        <>
          <p className="text-sm font-semibold text-fg">{g.title}</p>
          <div className="flex items-start gap-2">
            <Switch
              id={switchId}
              checked={fixed}
              onCheckedChange={(v) =>
                void run('setPartGrain', { id: part.id, mode: v ? 'fixed' : 'free', angle })
              }
              data-testid={`grain-fixed-${n}`}
            />
            <label htmlFor={switchId} className="flex flex-col gap-0.5 text-sm text-fg">
              {g.fixed}
              <span className="text-xs text-fg-muted">{g.fixedHint}</span>
            </label>
          </div>
          <GrainDial
            value={part.grain.angle}
            onValueChange={setLive}
            onValueCommit={(a) => {
              setLive(null);
              if (a !== part.grain.angle || !fixed) {
                run('setPartGrain', { id: part.id, mode: 'fixed', angle: a });
              }
            }}
            labels={grainDialLabels()}
            data-testid={`grain-dial-${n}`}
          />
          {allIds().length > 1 ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => {
                const ok = run('setPartsGrain', {
                  ids: allIds(),
                  mode: part.grain.mode,
                  angle: part.grain.angle,
                });
                if (ok) notify.success(fill(g.applied, { count: allIds().length }));
              }}
              data-testid={`grain-apply-all-${n}`}
            >
              {g.applyAll}
            </Button>
          ) : null}
        </>
      )}
    >
      {fixed ? <GrainArrow angle={angle} className="text-accent-text" /> : null}
      {fixed ? deg : g.free}
    </PopoverButton>
  );
}

/** A 4-side glyph: the banded edges drawn thick in accent, the others thin (T118 compact). */
export function BandGlyph({ sides }: { sides: readonly EdgeKey[] }) {
  const on = (e: EdgeKey) => sides.includes(e);
  const line = (e: EdgeKey) =>
    on(e) ? 'stroke-accent-text [stroke-width:2.5]' : 'stroke-border-strong [stroke-width:1]';
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0" fill="none">
      <line x1="2" y1="2" x2="14" y2="2" className={line('top')} strokeLinecap="round" />
      <line x1="2" y1="14" x2="14" y2="14" className={line('bottom')} strokeLinecap="round" />
      <line x1="2" y1="2" x2="2" y2="14" className={line('left')} strokeLinecap="round" />
      <line x1="14" y1="2" x2="14" y2="14" className={line('right')} strokeLinecap="round" />
    </svg>
  );
}

/** One edge band input of a row (Üst / Alt / Sol / Sağ, Q002). */
export function EdgeInput({
  t,
  part,
  row,
  edge,
  run,
  id,
  navigate,
}: {
  t: Text;
  part: Part;
  row: number;
  edge: EdgeKey;
  run: Run;
  /** Inputs outside the grid (popover, card) get their own ids. */
  id?: string | undefined;
  navigate?: Navigate | undefined;
}) {
  return (
    <TextCell
      row={row}
      col={`edge-${edge}`}
      id={id}
      numeric
      className="px-1.5"
      label={fill(t.edgeLabel, { n: row + 1, edge: t.edge[edge] })}
      value={formatInput(part.edgeBand[edge])}
      current={part.edgeBand[edge]}
      validate={(text) => validateBand(t.errors, text)}
      onCommit={(v) => run('updatePart', { id: part.id, edgeBand: { [edge]: v } })}
      rejected={t.errors.rejected}
      navigate={navigate}
    />
  );
}

/**
 * Compact edge band cell (T118): a 4-side glyph and the band count; a click opens the four
 * inputs (Üst / Alt / Sol / Sağ) in a popover.
 */
export function BandCell({
  t,
  part,
  row,
  run,
  navigate,
  glyphOnly = false,
}: {
  t: Text;
  part: Part;
  row: number;
  run: Run;
  navigate?: Navigate | undefined;
  /** Narrow grid (tablet): the glyph alone; the label names the sides. */
  glyphOnly?: boolean;
}) {
  const sides = bandedEdges(part);
  const n = row + 1;
  const summary =
    sides.length === 0
      ? t.bandCell.none
      : sides
          .map((e) => `${t.edge[e]} ${formatNumberTr(part.edgeBand[e], { maxDecimals: 2 })}`)
          .join(', ');
  return (
    <PopoverButton
      contentClassName="flex w-64 flex-col gap-3"
      id={cellId(row, 'band')}
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        'h-control-sm w-full justify-start gap-1.5 px-1.5 tabular-nums',
        sides.length === 0 ? 'text-fg-subtle' : 'text-fg',
      )}
      aria-label={fill(t.bandCell.edit, { n, sides: summary })}
      data-testid={`band-cell-${n}`}
      data-sides={sides.join(' ')}
      onKeyDown={navigate ? (e) => onButtonNav(e, row, 'band', navigate) : undefined}
      content={() => (
        <>
          <p className="text-sm font-semibold text-fg">{t.bandCell.title}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {EDGES.map((edge) => (
              <label key={edge} className="flex flex-col gap-1 text-xs text-fg-muted">
                <span aria-hidden>{t.edge[edge]}</span>
                <EdgeInput
                  t={t}
                  part={part}
                  row={row}
                  edge={edge}
                  run={run}
                  id={`cl-${row}-pop-${edge}`}
                />
              </label>
            ))}
          </div>
        </>
      )}
    >
      <BandGlyph sides={sides} />
      {glyphOnly ? null : (
        <span className="truncate text-xs">
          {sides.length === 0 ? '–' : fill(t.bandCell.sides, { count: sides.length })}
        </span>
      )}
    </PopoverButton>
  );
}
