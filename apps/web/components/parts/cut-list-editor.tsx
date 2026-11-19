'use client';

import {
  cutListToCsv,
  type CutListPartInput,
  type Part,
  type Project,
  type ValidationIssue,
} from '@nittcam/core';
import {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  cn,
  formatNumberTr,
  notify,
} from '@nittcam/ui';
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  ClipboardPaste,
  Copy,
  Download,
  Keyboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Rows3,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  EDGES,
  WIDE_BANDS_MIN,
  cellId,
  cutListSummary,
  formatInput,
  navColumns,
  navTarget,
  validatePositive,
  validateQty,
  type NavDirection,
} from '../../lib/cut-list-grid';
import { downloadText } from '../../lib/cut-list-file';
import { fill, newPartId } from '../../lib/draft-project';
import { useMediaQuery } from '../../lib/use-media-query';
import {
  BandCell,
  EdgeInput,
  GrainCell,
  TextCell,
  onButtonNav,
  type Navigate,
  type Run,
  type Text,
} from './cut-list-cells';
import { BulkEditSheet } from './cut-list-bulk';
import { PastePanel } from './paste-panel';

export type { Run } from './cut-list-cells';

/** Row height of the compact grid (T118, T195 compact density). */
const ROW_HEIGHT = 36;
/** Card height estimate below 640 px (measured after render). */
const CARD_HEIGHT = 196;

const features = tableFeatures({ columnSizingFeature, columnResizingFeature });
const column = createColumnHelper<typeof features, Part>();

/** Everything a cell needs besides its part; read through a ref so the columns stay stable. */
interface GridContext {
  t: Text;
  run: Run;
  navigate: Navigate;
  allIds: () => readonly string[];
  issuesOf: (index: number) => readonly ValidationIssue[];
  /** Row menu and shortcuts: act on the selection when the row is in it, else on the row. */
  rowAction: (row: number, action: RowAction) => void;
  isSelected: (id: string) => boolean;
  /** Click on a row's checkbox / number: plain toggles, Ctrl/⌘ toggles, Shift selects a range. */
  selectClick: (row: number, mods: { shift: boolean; ctrl: boolean }) => void;
  selectionCount: () => number;
  selectAll: (on: boolean) => void;
}

type RowAction = 'duplicate' | 'remove' | 'up' | 'down';

function issueText(t: Text, issue: ValidationIssue): string {
  return issue.code in t.issues ? t.issues[issue.code as keyof Text['issues']] : t.issues.other;
}

function NameCell({ ctx, part, row }: { ctx: GridContext; part: Part; row: number }) {
  const { t } = ctx;
  const issues = ctx.issuesOf(row);
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <TextCell
          row={row}
          col="name"
          label={fill(t.cellLabel, { n: row + 1, column: t.columns.name })}
          value={part.name}
          current={part.name}
          validate={(text) => ({ ok: true, value: text.trim() })}
          onCommit={(name) => ctx.run('updatePart', { id: part.id, name })}
          rejected={t.errors.rejected}
          navigate={ctx.navigate}
        />
      </div>
      {issues.length > 0 ? (
        <Tooltip content={issues.map((i) => issueText(t, i)).join(' ')}>
          <span
            tabIndex={-1}
            role="img"
            aria-label={fill(t.rowIssue, {
              n: row + 1,
              text: issues.map((i) => issueText(t, i)).join(' '),
            })}
            data-testid={`row-issue-${row + 1}`}
            data-codes={issues.map((i) => i.code).join(' ')}
            className="flex size-6 shrink-0 items-center justify-center text-warning-text"
          >
            <TriangleAlert aria-hidden className="size-3.5" />
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function SizeCell({
  ctx,
  part,
  row,
  field,
}: {
  ctx: GridContext;
  part: Part;
  row: number;
  field: 'w' | 'h';
}) {
  const { t } = ctx;
  if (part.kind !== 'rect') return <span className="block px-2 text-right text-fg-muted">–</span>;
  return (
    <TextCell
      row={row}
      col={field}
      numeric
      label={fill(t.cellLabel, { n: row + 1, column: t.columns[field] })}
      value={formatInput(part.params[field])}
      current={part.params[field]}
      validate={(text) => validatePositive(t.errors, text)}
      onCommit={(v) => ctx.run('updatePart', { id: part.id, params: { [field]: v } })}
      rejected={t.errors.rejected}
      navigate={ctx.navigate}
    />
  );
}

function QtyCell({ ctx, part, row }: { ctx: GridContext; part: Part; row: number }) {
  const { t } = ctx;
  return (
    <TextCell
      row={row}
      col="qty"
      numeric
      label={fill(t.cellLabel, { n: row + 1, column: t.columns.qty })}
      value={String(part.qty)}
      current={part.qty}
      validate={(text) => validateQty(t.errors, text)}
      onCommit={(qty) => ctx.run('updatePart', { id: part.id, qty })}
      rejected={t.errors.rejected}
      navigate={ctx.navigate}
    />
  );
}

function GrainColumnCell({ ctx, part, row }: { ctx: GridContext; part: Part; row: number }) {
  const { t, run } = ctx;
  return (
    <div className="flex items-center gap-0.5">
      <Checkbox
        tabIndex={-1}
        aria-label={fill(t.cellLabel, { n: row + 1, column: t.columns.grain })}
        checked={part.grain.mode === 'fixed'}
        onCheckedChange={(v) =>
          void run('setPartGrain', {
            id: part.id,
            mode: v === true ? 'fixed' : 'free',
            angle: part.grain.angle,
          })
        }
      />
      <GrainCell
        t={t}
        part={part}
        row={row}
        allIds={ctx.allIds}
        run={run}
        navigate={ctx.navigate}
      />
    </div>
  );
}

function NoteCell({ ctx, part, row }: { ctx: GridContext; part: Part; row: number }) {
  const { t } = ctx;
  return (
    <TextCell
      row={row}
      col="note"
      maxLength={200}
      label={fill(t.cellLabel, { n: row + 1, column: t.columns.note })}
      value={part.note ?? ''}
      current={part.note ?? ''}
      validate={(text) => ({ ok: true, value: text.trim() })}
      onCommit={(note) => ctx.run('updatePart', { id: part.id, note })}
      rejected={t.errors.rejected}
      navigate={ctx.navigate}
    />
  );
}

/** Row menu (T119): duplicate, move up / down, delete. */
function ActionsCell({ ctx, row }: { ctx: GridContext; part: Part; row: number }) {
  const { t } = ctx;
  const m = t.rowMenu;
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            id={cellId(row, 'actions')}
            size="sm"
            aria-label={fill(m.label, { n: row + 1 })}
            data-testid={`row-menu-${row + 1}`}
            onKeyDown={(e) => onButtonNav(e, row, 'actions', ctx.navigate)}
          >
            <MoreHorizontal aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => ctx.rowAction(row, 'duplicate')}>
            <Copy aria-hidden />
            {m.duplicate}
            <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => ctx.rowAction(row, 'up')}>
            <ArrowUp aria-hidden />
            {m.moveUp}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => ctx.rowAction(row, 'down')}>
            <ArrowDown aria-hidden />
            {m.moveDown}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => ctx.rowAction(row, 'remove')}>
            <Trash2 aria-hidden />
            {m.remove}
            <DropdownMenuShortcut>Delete</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Row number with the selection checkbox (T119). */
function IndexCell({ ctx, part, row }: { ctx: GridContext; part: Part; row: number }) {
  const selected = ctx.isSelected(part.id);
  return (
    <div className="flex items-center justify-between gap-1 pl-1.5">
      <Checkbox
        aria-label={fill(ctx.t.select.row, { n: row + 1 })}
        checked={selected}
        data-testid={`row-select-${row + 1}`}
        onClick={(e) => {
          e.preventDefault();
          ctx.selectClick(row, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
        }}
      />
      <span className="pr-1 text-xs text-fg-subtle tabular-nums">{row + 1}</span>
    </div>
  );
}

/** The grid's columns; `wideBands` shows the four edge band columns instead of one "Bant" cell. */
function buildColumns(t: Text, wideBands: boolean, ctx: { current: GridContext }) {
  const c = () => ctx.current;
  return column.columns([
    column.display({
      id: 'index',
      header: () => <SelectAllHeader ctx={c()} />,
      size: 56,
      enableResizing: false,
      cell: (info) => <IndexCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    column.display({
      id: 'name',
      header: t.columns.name,
      size: 120,
      minSize: 120,
      cell: (info) => <NameCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    column.display({
      id: 'w',
      header: t.columns.w,
      size: 76,
      minSize: 64,
      cell: (info) => (
        <SizeCell ctx={c()} part={info.row.original} row={info.row.index} field="w" />
      ),
    }),
    column.display({
      id: 'h',
      header: t.columns.h,
      size: 76,
      minSize: 64,
      cell: (info) => (
        <SizeCell ctx={c()} part={info.row.original} row={info.row.index} field="h" />
      ),
    }),
    column.display({
      id: 'qty',
      header: t.columns.qty,
      size: 56,
      minSize: 52,
      cell: (info) => <QtyCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    column.display({
      id: 'grain',
      header: t.columns.grainHeader,
      size: 104,
      minSize: 100,
      cell: (info) => <GrainColumnCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    ...(wideBands
      ? EDGES.map((edge) =>
          column.display({
            id: `edge-${edge}`,
            header: fill(t.edgeHeader, { edge: t.edge[edge] }),
            size: 64,
            minSize: 52,
            cell: (info) => (
              <EdgeInput
                t={c().t}
                part={info.row.original}
                row={info.row.index}
                edge={edge}
                run={c().run}
                navigate={c().navigate}
              />
            ),
          }),
        )
      : [
          column.display({
            id: 'band',
            header: t.columns.band,
            size: 72,
            minSize: 64,
            cell: (info) => (
              <BandCell
                t={c().t}
                part={info.row.original}
                row={info.row.index}
                run={c().run}
                navigate={c().navigate}
              />
            ),
          }),
        ]),
    column.display({
      id: 'note',
      header: t.columns.note,
      size: 100,
      minSize: 80,
      cell: (info) => <NoteCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    column.display({
      id: 'actions',
      header: () => <span className="sr-only">{t.columns.actions}</span>,
      size: 68,
      enableResizing: false,
      cell: (info) => <ActionsCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
  ]);
}

/** Numeric columns: header and content right-aligned. */
const NUMERIC = new Set(['index', 'w', 'h', 'qty']);

/** Width of an element, live (ResizeObserver). */
function useWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * One grid row, memoised: scrolling renders only the rows that come into view (T118 perf). It
 * re-renders when its part, its index, its warnings or the row count change.
 */
const GridRow = memo(function GridRow({
  row,
  index,
  selected,
  Render,
}: {
  row: { id: string; getAllCells: () => { id: string }[] };
  index: number;
  part: Part;
  issueKey: string;
  rowCount: number;
  /** The column set (wide / compact bands): a change re-renders every row. */
  columns: unknown;
  selected: boolean;
  Render: ComponentType<{ cell: unknown }>;
}) {
  return (
    <tr
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-testid="cut-list-row"
      className={cn(
        'transition-colors duration-(--duration-fast)',
        selected ? 'bg-accent-subtle' : 'hover:bg-surface-subtle',
      )}
    >
      {row.getAllCells().map((cell) => (
        <td key={cell.id} className="h-9 border-b border-border-subtle px-0.5 py-0.5">
          <Render cell={cell} />
        </td>
      ))}
    </tr>
  );
});

/** Desktop grid: TanStack Table (sizing + resizing) with virtual rows and a sticky header. */
function Grid({
  t,
  parts,
  ctx,
  wideBands,
  scrollRef,
  scrollToRow,
}: {
  t: Text;
  parts: readonly Part[];
  ctx: { current: GridContext };
  wideBands: boolean;
  scrollRef: { current: HTMLDivElement | null };
  scrollToRow: { current: ((row: number) => void) | null };
}) {
  const columns = useMemo(() => buildColumns(t, wideBands, ctx), [t, wideBands, ctx]);
  const table = useTable({
    features,
    columns,
    data: parts as Part[],
    getRowId: (p) => p.id,
    columnResizeMode: 'onChange',
  });
  const rows = table.getRowModel().rows;
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer re-renders this component itself
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: { width: 1000, height: 640 },
  });
  scrollToRow.current = (row) => virtualizer.scrollToIndex(row, { align: 'auto' });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const colCount = headers.length;
  const nameResized = table.state.columnSizing.name !== undefined;
  const ctxNow = ctx.current;

  return (
    <table
      className="w-full table-fixed border-separate border-spacing-0 text-left text-sm"
      style={{ minWidth: table.getTotalSize() }}
      aria-labelledby="cut-list-title"
      aria-rowcount={rows.length + 1}
      data-testid="cut-list-grid"
    >
      <colgroup>
        {headers.map((h) => (
          // The name column takes the free width until the user resizes it.
          <col
            key={h.id}
            style={{ width: h.id === 'name' && !nameResized ? undefined : h.getSize() }}
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {headers.map((h) => (
            <th
              key={h.id}
              scope="col"
              data-testid={h.id.startsWith('edge-') ? `edge-col-${h.id.slice(5)}` : undefined}
              className={cn(
                'sticky top-0 z-10 h-9 border-b border-border bg-surface-subtle px-2 text-xs font-medium whitespace-nowrap text-fg-muted',
                NUMERIC.has(h.id) && 'text-right',
              )}
            >
              <span className="block truncate">
                {h.isPlaceholder ? null : <table.FlexRender header={h} />}
              </span>
              {h.column.getCanResize() ? (
                <div
                  aria-hidden
                  onMouseDown={h.getResizeHandler()}
                  onTouchStart={h.getResizeHandler()}
                  onDoubleClick={() => h.column.resetSize()}
                  className={cn(
                    'absolute top-1.5 right-0 bottom-1.5 w-1.5 cursor-col-resize touch-none rounded-full select-none hover:bg-accent-border',
                    h.column.getIsResizing() && 'bg-accent',
                  )}
                />
              ) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {padTop > 0 ? (
          <tr aria-hidden>
            <td colSpan={colCount} style={{ height: padTop, padding: 0 }} />
          </tr>
        ) : null}
        {items.map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          return (
            <GridRow
              key={row.id}
              row={row}
              index={v.index}
              part={row.original}
              issueKey={ctxNow
                .issuesOf(v.index)
                .map((i) => i.code)
                .join(' ')}
              rowCount={rows.length}
              columns={columns}
              selected={ctxNow.isSelected(row.id)}
              Render={table.FlexRender as ComponentType<{ cell: unknown }>}
            />
          );
        })}
        {padBottom > 0 ? (
          <tr aria-hidden>
            <td colSpan={colCount} style={{ height: padBottom, padding: 0 }} />
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

/** Phone layout (390 px, T118): one card per part with the same cells, virtualised. */
function Cards({
  t,
  parts,
  ctx,
  scrollRef,
  scrollToRow,
}: {
  t: Text;
  parts: readonly Part[];
  ctx: { current: GridContext };
  scrollRef: { current: HTMLDivElement | null };
  scrollToRow: { current: ((row: number) => void) | null };
}) {
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer re-renders this component itself
  const virtualizer = useVirtualizer({
    count: parts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 4,
    initialRect: { width: 390, height: 640 },
  });
  scrollToRow.current = (row) => virtualizer.scrollToIndex(row, { align: 'auto' });
  const c = ctx.current;
  const field = (label: string, child: ReactNode, className?: string) => (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span aria-hidden className="px-2 text-2xs text-fg-subtle">
        {label}
      </span>
      {child}
    </div>
  );
  return (
    <ul
      aria-label={t.cards.label}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
      data-testid="cut-list-cards"
    >
      {virtualizer.getVirtualItems().map((v) => {
        const part = parts[v.index];
        if (!part) return null;
        const row = v.index;
        return (
          <li
            key={part.id}
            data-index={v.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0 px-3 py-1.5"
            style={{ transform: `translateY(${v.start}px)` }}
            data-testid="cut-list-row"
          >
            <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface p-2">
              <div className="flex items-center gap-1">
                <div className="w-14 shrink-0">
                  <IndexCell ctx={c} part={part} row={row} />
                </div>
                <div className="min-w-0 flex-1">
                  <NameCell ctx={c} part={part} row={row} />
                </div>
                <ActionsCell ctx={c} part={part} row={row} />
              </div>
              <div className="grid grid-cols-3 gap-1">
                {field(t.columns.w, <SizeCell ctx={c} part={part} row={row} field="w" />)}
                {field(t.columns.h, <SizeCell ctx={c} part={part} row={row} field="h" />)}
                {field(t.columns.qty, <QtyCell ctx={c} part={part} row={row} />)}
              </div>
              <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-end gap-1">
                {field(t.columns.grainHeader, <GrainColumnCell ctx={c} part={part} row={row} />)}
                {field(
                  t.columns.band,
                  <BandCell t={t} part={part} row={row} run={c.run} navigate={c.navigate} />,
                )}
                {field(t.columns.note, <NoteCell ctx={c} part={part} row={row} />)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Header checkbox: select all rows / none (T119). */
function SelectAllHeader({ ctx }: { ctx: GridContext }) {
  const count = ctx.selectionCount();
  const total = ctx.allIds().length;
  return (
    <div className="flex items-center pl-1.5">
      <Checkbox
        aria-label={ctx.t.select.all}
        checked={count === 0 ? false : count === total ? true : 'indeterminate'}
        onCheckedChange={(v) => ctx.selectAll(v === true)}
        data-testid="row-select-all"
      />
    </div>
  );
}

/** True when the key event comes from a text cell that is being edited (Delete edits text). */
function editingText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Row index from a grid cell id (`cl-<row>-<col>`), or null. */
function rowOfTarget(target: EventTarget | null): number | null {
  if (!(target instanceof HTMLElement)) return null;
  const m = /^cl-(\d+)-/.exec(target.closest('[id^="cl-"]')?.id ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * The cut-list editor of the wizard's Parçalar step (T011, T011b, T118, T119; spec §3.6 step 2,
 * §4.1): a spreadsheet-like grid (cards on phones), row actions, multi-select with bulk edit and
 * the Excel/CSV paste. It never changes the project itself: every edit runs a command through
 * `run` (command layer), so undo/redo, autosave and validation see it.
 */
export function CutListEditor({
  t,
  project,
  issues,
  run,
  onUndo,
  onShowIssues,
}: {
  t: Text;
  project: Project;
  issues: readonly ValidationIssue[];
  run: Run;
  /** Undo of the last command (the "Geri al" action of toasts, T246). */
  onUndo?: () => void;
  /** Brings the Uyarılar panel into view (the issue chip, T246). */
  onShowIssues?: () => void;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToRow = useRef<((row: number) => void) | null>(null);
  const phone = !useMediaQuery('(min-width: 640px)');
  const width = useWidth(scrollRef);
  const wideBands = !phone && width >= WIDE_BANDS_MIN;

  const parts = project.parts;
  const summary = cutListSummary(project);
  const cols = useMemo(() => navColumns(wideBands), [wideBands]);
  // Ids of removed parts drop out of the selection (undo, delete, another screen).
  const selected = useMemo(() => {
    const have = new Set(parts.map((p) => p.id));
    return parts.filter((p) => selection.has(p.id) && have.has(p.id)).map((p) => p.id);
  }, [parts, selection]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  /** Focuses a cell, scrolling its row into view first when it is not rendered yet. */
  function focusCell(row: number, col: string, tries = 3) {
    const el = document.getElementById(cellId(row, col));
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
      return;
    }
    scrollToRow.current?.(row);
    if (tries > 0) requestAnimationFrame(() => focusCell(row, col, tries - 1));
  }

  useEffect(() => {
    if (focusNext.current) {
      const [row, col] = focusNext.current.split('|');
      focusNext.current = null;
      focusCell(Number(row), col ?? 'name');
    }
  });

  function addRow(col = 'name') {
    const ok = run('addPart', {
      id: newPartId(),
      name: fill(t.defaultName, { n: parts.length + 1 }),
      params: { w: 100, h: 100, r: 0 },
    });
    if (ok) {
      focusNext.current = `${parts.length}|${col}`;
      scrollToRow.current?.(parts.length);
    }
  }

  const navigate: Navigate = (row: number, col: string, dir: NavDirection, enter = false) => {
    const target = navTarget(row, col, dir, parts.length, cols, enter);
    if (!target) return;
    if ('append' in target) addRow(target.col === 'actions' ? 'name' : target.col);
    else focusCell(target.row, target.col);
  };

  const issuesOf = (index: number) =>
    issues.filter((i) => i.path === `parts[${index}]` || i.path.startsWith(`parts[${index}].`));

  const undoAction = onUndo ? { action: { label: t.undo, onClick: onUndo } } : {};

  /** The rows an action works on: the selection when the row is in it, else the row alone. */
  function targetIds(row: number | null): string[] {
    const id = row === null ? undefined : parts[row]?.id;
    if (id !== undefined && !selectedSet.has(id)) return [id];
    return selected;
  }

  function act(action: RowAction, ids: readonly string[]) {
    if (ids.length === 0) return;
    if (action === 'remove') {
      if (run('removeParts', { ids })) {
        setSelection(new Set());
        notify.success(fill(t.removed, { count: ids.length }), {
          id: 'cut-list-rows',
          ...undoAction,
        });
      }
    } else if (action === 'duplicate') {
      if (run('duplicateParts', { ids, newIds: ids.map(() => newPartId()) })) {
        notify.success(fill(t.duplicated, { count: ids.length }), {
          id: 'cut-list-rows',
          ...undoAction,
        });
      }
    } else {
      run('reorderParts', { ids, direction: action });
    }
  }

  function selectClick(row: number, mods: { shift: boolean; ctrl: boolean }) {
    const id = parts[row]?.id;
    if (!id) return;
    const from = anchor.current ? parts.findIndex((p) => p.id === anchor.current) : -1;
    if (mods.shift && from >= 0) {
      const [a, b] = from < row ? [from, row] : [row, from];
      const range = parts.slice(a, b + 1).map((p) => p.id);
      setSelection(new Set(mods.ctrl ? [...selected, ...range] : range));
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    anchor.current = id;
    setSelection(next);
  }

  // Cells call through this ref, so memoised rows always reach the current project and handlers.
  const latest = useRef({
    run,
    navigate,
    parts,
    issuesOf,
    act,
    targetIds,
    selectClick,
    selectedSet,
    setSelection,
  });
  latest.current = {
    run,
    navigate,
    parts,
    issuesOf,
    act,
    targetIds,
    selectClick,
    selectedSet,
    setSelection,
  };
  const ctx = useMemo(
    () => ({
      current: {
        t,
        run: (name: string, params: unknown) => latest.current.run(name, params),
        navigate: ((row, col, dir, enter) =>
          latest.current.navigate(row, col, dir, enter)) as Navigate,
        allIds: () => latest.current.parts.map((p) => p.id),
        issuesOf: (index: number) => latest.current.issuesOf(index),
        rowAction: (row: number, action: RowAction) =>
          latest.current.act(action, latest.current.targetIds(row)),
        isSelected: (id: string) => latest.current.selectedSet.has(id),
        selectClick: (row: number, mods: { shift: boolean; ctrl: boolean }) =>
          latest.current.selectClick(row, mods),
        selectionCount: () => latest.current.selectedSet.size,
        selectAll: (on: boolean) =>
          latest.current.setSelection(new Set(on ? latest.current.parts.map((p) => p.id) : [])),
      } satisfies GridContext,
    }),
    [t],
  );

  /** Ctrl+D duplicates, Delete removes (outside text cells), Esc clears the selection. */
  function onGridKey(e: KeyboardEvent<HTMLElement>) {
    const row = rowOfTarget(e.target);
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      act('duplicate', targetIds(row));
    } else if (e.key === 'Delete' && !editingText(e.target)) {
      const ids = targetIds(row);
      if (ids.length > 0) {
        e.preventDefault();
        act('remove', ids);
      }
    } else if (e.key === 'Escape' && selected.length > 0 && !editingText(e.target)) {
      setSelection(new Set());
    }
  }

  function applyPaste(rows: CutListPartInput[]): boolean {
    const ok = run('importCutList', { parts: rows });
    if (ok) {
      setPasteOpen(false);
      notify.success(fill(t.paste.applied, { count: rows.length }), {
        id: 'cut-list-paste',
        ...undoAction,
      });
      requestAnimationFrame(() => pasteButton.current?.focus());
    }
    return ok;
  }

  function applyBulk(params: Record<string, unknown>): boolean {
    const ok = run('updateParts', params);
    if (ok) {
      notify.success(fill(t.updated, { count: selected.length }), {
        id: 'cut-list-rows',
        ...undoAction,
      });
    }
    return ok;
  }

  /** CSV download of the rectangle parts (T120): semicolon, decimal comma, UTF-8 BOM. */
  function exportCsv() {
    const csv = cutListToCsv(parts);
    downloadText(t.exportFile, csv.text);
    if (csv.skipped > 0) notify.info(fill(t.exportSkipped, { count: csv.skipped }));
    else notify.success(fill(t.exported, { count: csv.rows }));
  }

  const problemCount = issues.length;
  const s = t.select;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {pasteOpen ? (
        <PastePanel
          t={t.paste}
          intro={t.subtitle}
          onApply={applyPaste}
          onCancel={() => setPasteOpen(false)}
        />
      ) : null}

      <section
        aria-labelledby="cut-list-title"
        data-density="compact"
        onKeyDown={onGridKey}
        className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs"
      >
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
          {selected.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="selection-bar">
              <span className="text-sm font-medium text-fg tabular-nums" role="status">
                {fill(s.count, { count: selected.length })}
              </span>
              <Button size="sm" onClick={() => setBulkOpen(true)} data-testid="bulk-open">
                <Pencil aria-hidden />
                {s.bulkEdit}
              </Button>
              <Button variant="outline" size="sm" onClick={() => act('duplicate', selected)}>
                <Copy aria-hidden />
                {t.rowMenu.duplicate}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="hover:bg-danger-subtle hover:text-danger-text"
                onClick={() => act('remove', selected)}
                data-testid="selection-remove"
              >
                <Trash2 aria-hidden />
                {t.rowMenu.remove}
              </Button>
              <Tooltip content={s.clear}>
                <IconButton size="sm" aria-label={s.clear} onClick={() => setSelection(new Set())}>
                  <X aria-hidden />
                </IconButton>
              </Tooltip>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <h2 id="cut-list-title" className="text-base font-semibold tracking-tight text-fg">
                {t.tableLabel}
              </h2>
              {problemCount === 0 ? (
                <span
                  data-testid="cut-list-issue-chip"
                  data-count={0}
                  className="inline-flex h-6 items-center gap-1 rounded-sm border border-success-border bg-success-subtle px-2 text-xs font-medium text-success-text"
                >
                  <CircleCheck aria-hidden className="size-3.5" />
                  {t.issueChip.ok}
                </span>
              ) : (
                <button
                  type="button"
                  data-testid="cut-list-issue-chip"
                  data-count={problemCount}
                  onClick={onShowIssues}
                  className="inline-flex h-6 items-center gap-1 rounded-sm border border-warning-border bg-warning-subtle px-2 text-xs font-medium text-warning-text outline-none hover:bg-warning-subtle/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <TriangleAlert aria-hidden className="size-3.5" />
                  {fill(t.issueChip.count, { count: problemCount })}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => addRow()}>
              <Plus aria-hidden />
              {t.addRow}
            </Button>
            <Tooltip content={t.exportCsvHint}>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={parts.length === 0}
                data-testid="cut-list-export"
              >
                <Download aria-hidden />
                {t.exportCsv}
              </Button>
            </Tooltip>
            <Button
              ref={pasteButton}
              size="sm"
              aria-expanded={pasteOpen}
              aria-controls="paste-panel"
              onClick={() => setPasteOpen((o) => !o)}
            >
              <ClipboardPaste aria-hidden />
              {t.pasteOpen}
            </Button>
          </div>
        </div>
        {selected.length > 0 ? (
          // The title stays the section's name while the selection bar replaces it.
          <h2 id="cut-list-title" className="sr-only">
            {t.tableLabel}
          </h2>
        ) : null}
        <div
          ref={scrollRef}
          className={cn(
            'relative max-w-full overflow-auto',
            parts.length === 0 ? '' : 'max-h-[max(22rem,calc(100dvh-20rem))]',
          )}
          data-testid="cut-list-scroll"
        >
          {parts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-subtle text-fg-muted">
                <Rows3 aria-hidden className="size-5" />
              </span>
              <p className="text-sm font-medium text-fg">{t.empty}</p>
              <p className="max-w-sm text-sm text-fg-muted">{t.subtitle}</p>
            </div>
          ) : phone ? (
            <Cards t={t} parts={parts} ctx={ctx} scrollRef={scrollRef} scrollToRow={scrollToRow} />
          ) : (
            <Grid
              t={t}
              parts={parts}
              ctx={ctx}
              wideBands={wideBands}
              scrollRef={scrollRef}
              scrollToRow={scrollToRow}
            />
          )}
        </div>
        <footer
          aria-label={t.summary.label}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle px-4 py-2 text-xs text-fg-muted tabular-nums"
        >
          <span data-testid="cut-list-count">
            {fill(t.count, { rows: summary.rows, pieces: summary.pieces })}
          </span>
          <span aria-hidden className="text-fg-subtle">
            ·
          </span>
          <span data-testid="cut-list-area" data-value={summary.areaM2}>
            {fill(t.summary.area, { area: formatNumberTr(summary.areaM2, { maxDecimals: 2 }) })}
          </span>
          <span aria-hidden className="text-fg-subtle">
            ·
          </span>
          <Tooltip content={t.summary.sheetsHint}>
            <span tabIndex={0} data-testid="cut-list-sheets" data-value={summary.sheets}>
              {fill(t.summary.sheets, { count: summary.sheets })}
            </span>
          </Tooltip>
          <span className="flex-1" />
          <Tooltip content={t.shortcuts}>
            <IconButton size="sm" aria-label={t.summary.shortcuts} data-testid="cut-list-shortcuts">
              <Keyboard aria-hidden />
            </IconButton>
          </Tooltip>
        </footer>
      </section>
      <BulkEditSheet
        t={t}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        ids={selected}
        onApply={applyBulk}
      />
    </div>
  );
}
