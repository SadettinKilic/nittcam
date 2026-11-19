'use client';

import {
  cutListToCsv,
  partBoxSize,
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
  Input,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  LiteCheckbox,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tooltip,
  cn,
  focusRing,
  formatNumberTr,
  notify,
} from '@nittcam/ui';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  FileUp,
  Keyboard,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import {
  EDGES,
  NARROW_GRID_MAX,
  WIDE_BANDS_MIN,
  bandedEdges,
  cellId,
  cutListSummary,
  formatInput,
  navColumns,
  navTarget,
  validatePositive,
  validateQty,
  type EdgeKey,
  type NavDirection,
} from '../../lib/cut-list-grid';
import { downloadText } from '../../lib/cut-list-file';
import {
  SORT_KEYS,
  cutListView,
  issueRows,
  nextSort,
  type GroupItem,
  type Sort,
  type SortKey,
  type ViewItem,
} from '../../lib/cut-list-view';
import { fill, newPartId, stockHasGrain } from '../../lib/draft-project';
import { CabinetDialog, cabinetRows, nextCabinetName } from './cabinet-dialog';
import { DxfImportDialog } from './dxf-import-dialog';
import type { Messages } from '../../lib/messages';
import { activateAt } from '../../lib/light-press';
import { useMediaQuery } from '../../lib/use-media-query';
import { mayAutoOpen, readDismissed, writeDismissed } from '../../lib/issues-dismissed';

/** Width of the floating Uyarılar panel (22rem) and its gap to the grid, px (T256). */
const ISSUES_PANEL_PX = 352;
const ISSUES_GAP_PX = 16;
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
import { IssuesOkChip } from '../wizard/issues-ok-chip';

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
  /** Ids of the rows the view shows (T123): "select all" selects these. */
  visibleIds: () => readonly string[];
  selectAll: (on: boolean) => void;
  /** Opens the shared row menu (T119) at a row's ⋯ button. */
  openRowMenu: (row: number, anchor: HTMLElement) => void;
}

type RowAction = 'duplicate' | 'remove' | 'up' | 'down';

function issueText(t: Text, issue: ValidationIssue): string {
  const text =
    issue.code in t.issues ? t.issues[issue.code as keyof Text['issues']] : t.issues.other;
  // T275: a hole error names its hole, one line per hole ("Delik 3: Delik, takımdan küçük.").
  const hole = /^parts\[\d+\]\.holes\[(\d+)\]/.exec(issue.path);
  if (hole) return fill(t.issues.holeN, { n: Number(hole[1]) + 1, text });
  // T277: an open line likewise.
  const line = /^parts\[\d+\]\.lines\[(\d+)\]/.exec(issue.path);
  return line ? fill(t.issues.lineN, { n: Number(line[1]) + 1, text }) : text;
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

/** The part's group label (cabinet / tag, T122, T123); empty removes it. */
function GroupCell({ ctx, part, row }: { ctx: GridContext; part: Part; row: number }) {
  const { t } = ctx;
  return (
    <TextCell
      row={row}
      col="group"
      maxLength={60}
      label={fill(t.cellLabel, { n: row + 1, column: t.columns.group })}
      value={part.group ?? ''}
      current={part.group ?? ''}
      validate={(text) => ({ ok: true, value: text.trim() })}
      onCommit={(group) => ctx.run('updatePart', { id: part.id, group })}
      rejected={t.errors.rejected}
      navigate={ctx.navigate}
    />
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
  if (part.kind !== 'rect') {
    // Freeform part (T135): the drawing is the source; W/H are its bounding box, read-only here.
    const value = formatInput(partBoxSize(part)[field]);
    return (
      <span
        className="flex h-9 flex-col items-end justify-center px-2 text-right leading-tight text-fg-muted"
        title={t.freeformSize}
        data-testid={`cell-${field}-freeform`}
      >
        {field === 'w' ? <span className="text-[10px] text-fg-subtle">{t.freeform}</span> : null}
        <span className="font-mono text-sm tabular-nums">{value}</span>
      </span>
    );
  }
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

function GrainColumnCell({
  ctx,
  part,
  row,
  narrow = false,
}: {
  ctx: GridContext;
  part: Part;
  row: number;
  /** Narrow grid (tablet): no lock checkbox; the popover's switch does the same. */
  narrow?: boolean;
}) {
  const { t, run } = ctx;
  return (
    <div className="flex items-center gap-0.5">
      {narrow ? null : (
        <LiteCheckbox
          tabIndex={-1}
          aria-label={fill(t.cellLabel, { n: row + 1, column: t.columns.grain })}
          checked={part.grain.mode === 'fixed'}
          onClick={() =>
            void run('setPartGrain', {
              id: part.id,
              mode: part.grain.mode === 'fixed' ? 'free' : 'fixed',
              angle: part.grain.angle,
            })
          }
        />
      )}
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

/** Row menu button (T119): opens the one shared `RowMenu` (no menu root per row, T118 perf). */
function ActionsCell({ ctx, row }: { ctx: GridContext; part: Part; row: number }) {
  return (
    <div className="flex justify-end">
      <IconButton
        id={cellId(row, 'actions')}
        size="sm"
        aria-label={fill(ctx.t.rowMenu.label, { n: row + 1 })}
        aria-haspopup="menu"
        data-testid={`row-menu-${row + 1}`}
        onClick={(e) => ctx.openRowMenu(row, e.currentTarget)}
        onKeyDown={(e) => onButtonNav(e, row, 'actions', ctx.navigate)}
      >
        <MoreHorizontal aria-hidden />
      </IconButton>
    </div>
  );
}

/**
 * The row menu: duplicate, move up / down, delete. One instance for the whole list, anchored at
 * the pressed row's button; focus goes back to that button when it closes.
 */
function RowMenu({
  t,
  openerRef,
  rowAction,
  canMove,
}: {
  t: Text;
  openerRef: { current: ((row: number, anchor: HTMLElement) => void) | null };
  rowAction: (row: number, action: RowAction) => void;
  /** False while the view is sorted (T123): moving a row has no visible place then. */
  canMove: boolean;
}) {
  const [at, setAt] = useState<{ row: number; rect: DOMRect } | null>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    openerRef.current = (row, anchor) => {
      setAt({ row, rect: anchor.getBoundingClientRect() });
      setOpen(true);
    };
  }, [openerRef]);
  if (!at) return null;
  const m = t.rowMenu;
  const item = (action: RowAction) => () => rowAction(at.row, action);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed"
          style={{
            left: at.rect.left,
            top: at.rect.top,
            width: at.rect.width,
            height: at.rect.height,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={fill(m.label, { n: at.row + 1 })}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById(cellId(at.row, 'actions'))?.focus();
        }}
      >
        <DropdownMenuItem onSelect={item('duplicate')}>
          <Copy aria-hidden />
          {m.duplicate}
          <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={item('up')} disabled={!canMove}>
          <ArrowUp aria-hidden />
          {m.moveUp}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={item('down')} disabled={!canMove}>
          <ArrowDown aria-hidden />
          {m.moveDown}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={item('remove')}>
          <Trash2 aria-hidden />
          {m.remove}
          <DropdownMenuShortcut>Delete</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Row number with the selection checkbox (T119). */
function IndexCell({ ctx, part, row }: { ctx: GridContext; part: Part; row: number }) {
  const selected = ctx.isSelected(part.id);
  return (
    <div className="flex items-center justify-between gap-1 pl-1.5">
      <LiteCheckbox
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

/**
 * The grid's columns; `wideBands` shows the four edge band columns instead of one "Bant" cell.
 * `narrow` (container below NARROW_GRID_MAX, tablets) narrows every column so the grid fits a
 * 768 px screen without a sideways scroll: short W / H headers, no grain checkbox, a glyph-only
 * band cell.
 */
function buildColumns(t: Text, wideBands: boolean, narrow: boolean, ctx: { current: GridContext }) {
  const c = () => ctx.current;
  const size = (normal: number, small: number) => (narrow ? small : normal);
  return column.columns([
    column.display({
      id: 'index',
      header: () => <SelectAllHeader ctx={c()} />,
      size: size(56, 48),
      enableResizing: false,
      cell: (info) => <IndexCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    column.display({
      id: 'name',
      header: t.columns.name,
      size: size(120, 74),
      minSize: size(120, 74),
      cell: (info) => <NameCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    column.display({
      id: 'w',
      header: narrow ? t.columns.wShort : t.columns.w,
      size: size(76, 56),
      minSize: size(64, 52),
      cell: (info) => (
        <SizeCell ctx={c()} part={info.row.original} row={info.row.index} field="w" />
      ),
    }),
    column.display({
      id: 'h',
      header: narrow ? t.columns.hShort : t.columns.h,
      size: size(76, 56),
      minSize: size(64, 52),
      cell: (info) => (
        <SizeCell ctx={c()} part={info.row.original} row={info.row.index} field="h" />
      ),
    }),
    column.display({
      id: 'qty',
      header: t.columns.qty,
      size: size(56, 44),
      minSize: size(52, 44),
      cell: (info) => <QtyCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    column.display({
      id: 'grain',
      header: t.columns.grainHeader,
      size: size(104, 66),
      minSize: size(100, 64),
      cell: (info) => (
        <GrainColumnCell ctx={c()} part={info.row.original} row={info.row.index} narrow={narrow} />
      ),
    }),
    ...(wideBands
      ? EDGES.map((edge) =>
          column.display({
            id: `edge-${edge}`,
            header: fill(t.edgeHeader, { edge: t.edge[edge] }),
            size: 78,
            minSize: 60,
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
            size: size(72, 44),
            minSize: size(64, 44),
            cell: (info) => (
              <BandCell
                t={c().t}
                part={info.row.original}
                row={info.row.index}
                run={c().run}
                navigate={c().navigate}
                glyphOnly={narrow}
              />
            ),
          }),
        ]),
    column.display({
      id: 'note',
      header: t.columns.note,
      size: size(100, 64),
      minSize: size(80, 56),
      cell: (info) => <NoteCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
    // T123: the group label, after Not so the typing path (Ad → En → Boy → Adet) stays short;
    // editable; the narrow (tablet) grid leaves it to the group headers.
    ...(narrow
      ? []
      : [
          column.display({
            id: 'group',
            header: t.columns.group,
            size: 96,
            minSize: 72,
            cell: (info) => <GroupCell ctx={c()} part={info.row.original} row={info.row.index} />,
          }),
        ]),
    column.display({
      id: 'actions',
      header: () => <span className="sr-only">{t.columns.actions}</span>,
      size: size(68, 36),
      enableResizing: false,
      cell: (info) => <ActionsCell ctx={c()} part={info.row.original} row={info.row.index} />,
    }),
  ]);
}

/** A pressed toggle button of the view bar (T123). */
const PRESSED =
  'border-accent-border bg-accent-subtle text-accent-text hover:bg-accent-subtle hover:text-accent-text';

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
interface GridRowProps {
  row: { id: string; getAllCells: () => { id: string; column: { id: string } }[] };
  /** Index of the part in the project (cell ids, labels, issues). */
  index: number;
  /** Position in the view (T123): sorting and groups move rows without changing `index`. */
  position: number;
  part: Part;
  issueKey: string;
  rowCount: number;
  /** The column set (wide / compact bands): a change re-renders every row. */
  columns: unknown;
  selected: boolean;
  /** Mounted during a fast scroll: a text-only row until scrolling stops (T118 perf). */
  light: boolean;
  /** A press on a light cell: render the row in full and focus the pressed control (stable). */
  onLightPress: (e: ReactMouseEvent<HTMLTableCellElement>, rowId: string) => void;
  t: Text;
  Render: ComponentType<{ cell: unknown }>;
}

/** What a light row shows in a column: the cell's value as plain text. */
/** Part id of the grid row that holds `el` (T261), or null. */
function rowIdOf(el: EventTarget | null): string | null {
  return el instanceof Element
    ? (el.closest('tr[data-part-id]')?.getAttribute('data-part-id') ?? null)
    : null;
}

/** Do command params name this part (`id` or `ids`)? An edit of the row (T261). */
function namesPart(params: unknown, id: string): boolean {
  if (typeof params !== 'object' || params === null) return false;
  const p = params as { id?: unknown; ids?: unknown };
  return p.id === id || (Array.isArray(p.ids) && p.ids.includes(id));
}

/** A row exactly as Enter appended it: 100 × 100, one piece, nothing else set (T261). */
function untouchedNewRow(part: Part): boolean {
  return (
    part.kind === 'rect' &&
    part.params.w === 100 &&
    part.params.h === 100 &&
    part.params.r === 0 &&
    part.qty === 1 &&
    part.note === undefined &&
    part.group === undefined &&
    part.grain.mode === 'free' &&
    Object.values(part.edgeBand).every((v) => v === 0)
  );
}

function lightText(t: Text, part: Part, index: number, col: string): string {
  const rect = part.kind === 'rect';
  switch (col) {
    case 'index':
      return String(index + 1);
    case 'name':
      return part.name;
    case 'w':
    case 'h':
      return rect ? formatInput(part.params[col]) : formatInput(partBoxSize(part)[col]);
    case 'qty':
      return String(part.qty);
    case 'grain':
      return part.grain.mode === 'fixed'
        ? `${formatNumberTr(part.grain.angle, { maxDecimals: 1 })}°`
        : t.grainCell.free;
    case 'band': {
      const n = bandedEdges(part).length;
      return n === 0 ? '–' : fill(t.bandCell.sides, { count: n });
    }
    case 'note':
      return part.note ?? '';
    case 'group':
      return part.group ?? '';
    default: {
      if (!col.startsWith('edge-')) return '';
      // T253: a zero band is a quiet dash, as in the full cell.
      const v = part.edgeBand[col.slice(5) as EdgeKey];
      return v === 0 ? '–' : formatInput(v);
    }
  }
}

/** Light cells line their text up with the inputs (td 2 px + input border 1 px + padding 8 px). */
const LIGHT_TD =
  'h-9 truncate border-b border-border-subtle px-[11px] py-0.5 text-sm whitespace-pre text-fg';

const GridRow = memo(function GridRow({
  row,
  index,
  position,
  part,
  selected,
  light,
  onLightPress,
  t,
  Render,
}: GridRowProps) {
  return (
    <tr
      aria-rowindex={position + 2}
      aria-selected={selected}
      data-testid="cut-list-row"
      data-part-id={part.id}
      // No color transition on rows: a transition on every row made scrolling restyle-heavy (T118).
      className={selected ? 'bg-accent-subtle' : 'hover:bg-surface-subtle'}
    >
      {row.getAllCells().map((cell) =>
        light ? (
          // No inputs, buttons or icons: a row mounted mid-scroll costs a few text cells.
          <td
            key={cell.id}
            className={cn(
              LIGHT_TD,
              NUMERIC.has(cell.column.id) && 'text-right tabular-nums',
              cell.column.id === 'index' && 'text-xs text-fg-subtle',
              (cell.column.id === 'grain' || cell.column.id === 'band') && 'text-fg-subtle',
              cell.column.id.startsWith('edge-') &&
                part.edgeBand[cell.column.id.slice(5) as EdgeKey] === 0 &&
                'text-fg-subtle',
            )}
            // The first click on a row mounted mid-scroll must not be lost (B7 r2).
            onMouseDown={(e) => onLightPress(e, row.id)}
          >
            {lightText(t, part, index, cell.column.id)}
          </td>
        ) : (
          <td key={cell.id} className="h-9 border-b border-border-subtle px-0.5 py-0.5">
            <Render cell={cell} />
          </td>
        ),
      )}
    </tr>
  );
}, sameRow);

/**
 * GridRow's memo test: only what a row shows. The TanStack row object and the renderer are left
 * out on purpose; a row with the same part, index and column set renders the same cells.
 */
function sameRow(a: GridRowProps, b: GridRowProps): boolean {
  return (
    a.part === b.part &&
    a.index === b.index &&
    a.position === b.position &&
    a.issueKey === b.issueKey &&
    a.rowCount === b.rowCount &&
    a.columns === b.columns &&
    a.selected === b.selected &&
    a.light === b.light
  );
}

/** Columns a header press sorts by (T123); the index column means project order (no sort). */
const SORTABLE = new Set<string>(SORT_KEYS);

/** Sort state of a header cell for `aria-sort`. */
function ariaSort(sort: Sort | null, id: string): 'ascending' | 'descending' | undefined {
  if (!sort || sort.key !== id) return undefined;
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/**
 * A group header row (T123): the label, its row / piece count and a collapse button. Collapsing
 * only hides rows in the view; the project keeps every part.
 */
function GroupRow({
  t,
  item,
  position,
  colCount,
  onToggle,
}: {
  t: Text;
  item: GroupItem;
  position: number;
  colCount: number;
  onToggle: (key: string) => void;
}) {
  const label = item.key || t.view.ungrouped;
  return (
    <tr aria-rowindex={position + 2} data-testid="cut-list-group" data-group={item.key}>
      <td
        colSpan={colCount}
        className="h-9 border-b border-border-subtle bg-surface-subtle px-1.5 py-0.5"
      >
        <button
          type="button"
          aria-expanded={!item.collapsed}
          data-testid="cut-list-group-toggle"
          onClick={() => onToggle(item.key)}
          className={cn(
            'flex h-control-sm items-center gap-1.5 rounded-md px-1.5 text-sm outline-none hover:bg-surface-hover',
            focusRing,
          )}
        >
          {item.collapsed ? (
            <ChevronRight aria-hidden className="size-4 text-fg-muted" />
          ) : (
            <ChevronDown aria-hidden className="size-4 text-fg-muted" />
          )}
          <span className={cn('font-medium', item.key ? 'text-fg' : 'text-fg-muted')}>{label}</span>
          <span className="text-xs text-fg-subtle tabular-nums">
            {fill(t.view.groupCount, { rows: item.rows, pieces: item.pieces })}
          </span>
        </button>
      </td>
    </tr>
  );
}

/** Desktop grid: TanStack Table (sizing + resizing) with virtual rows and a sticky header. */
function Grid({
  t,
  parts,
  items,
  ctx,
  wideBands,
  narrow,
  scrollRef,
  scrollToRow,
  sort,
  onSort,
  onToggleGroup,
  reserveRight = 0,
  onTotalSize,
}: {
  t: Text;
  parts: readonly Part[];
  /** The view (T123): group headers and part rows in display order. */
  items: readonly ViewItem[];
  ctx: { current: GridContext };
  wideBands: boolean;
  narrow: boolean;
  scrollRef: { current: HTMLDivElement | null };
  /** Scrolls a part (project index) into view. */
  scrollToRow: { current: ((row: number) => void) | null };
  sort: Sort | null;
  onSort: (key: SortKey) => void;
  onToggleGroup: (key: string) => void;
  /** Width (px) kept free right of the last column for the Uyarılar panel (T256). */
  reserveRight?: number;
  /** Reports the columns' total width (px), so the editor knows whether the panel fits. */
  onTotalSize?: (px: number) => void;
}) {
  const columns = useMemo(
    () => buildColumns(t, wideBands, narrow, ctx),
    [t, wideBands, narrow, ctx],
  );
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
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    // Rows mount while scrolling (T118 perf): a small overscan keeps each frame's work small.
    overscan: 4,
    initialRect: { width: 1000, height: 640 },
  });
  // Light rows (T118 perf): a row that mounts while the user scrolls renders without inputs, and
  // gets them when scrolling stops. Rows that already have inputs keep them (a focused cell is never
  // swapped), and a scroll from keyboard navigation mounts full rows, so the target can take focus.
  const [lightState] = useState(() => ({ full: new Set<string>(), nav: false }));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  scrollToRow.current = (row) => {
    const position = items.findIndex((it) => it.kind === 'part' && it.index === row);
    if (position < 0) return;
    lightState.nav = true;
    rerender();
    virtualizer.scrollToIndex(position, { align: 'auto' });
  };
  // A press on a light cell (B7 r2): the browser would focus nothing, so keep it from moving focus,
  // render the row in full right now and focus the control under the pointer.
  const [onLightPress] = useState(
    () => (e: ReactMouseEvent<HTMLTableCellElement>, rowId: string) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const td = e.currentTarget;
      const { clientX, clientY } = e;
      lightState.full.add(rowId);
      flushSync(rerender);
      activateAt(td, clientX, clientY);
    },
  );
  if (!virtualizer.isScrolling) lightState.nav = false;
  const lightAllowed = virtualizer.isScrolling && !lightState.nav;
  const nextFull = new Set<string>();
  const virtualItems = virtualizer.getVirtualItems();
  const padTop = virtualItems[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0);
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const colCount = headers.length;
  const nameResized = table.state.columnSizing.name !== undefined;
  const ctxNow = ctx.current;
  const rowEls = virtualItems.map((v) => {
    const item = items[v.index];
    if (!item) return null;
    if (item.kind === 'group') {
      return (
        <GroupRow
          key={`group:${item.key}`}
          t={t}
          item={item}
          position={v.index}
          colCount={colCount}
          onToggle={onToggleGroup}
        />
      );
    }
    const row = rows[item.index];
    if (!row) return null;
    const light = lightAllowed && !lightState.full.has(row.id);
    if (!light) nextFull.add(row.id);
    return (
      <GridRow
        key={row.id}
        row={row}
        index={item.index}
        position={v.index}
        part={row.original}
        issueKey={ctxNow
          .issuesOf(item.index)
          .map((i) => i.code)
          .join(' ')}
        rowCount={rows.length}
        columns={columns}
        selected={ctxNow.isSelected(row.id)}
        light={light}
        onLightPress={onLightPress}
        t={t}
        Render={table.FlexRender as ComponentType<{ cell: unknown }>}
      />
    );
  });
  lightState.full = nextFull;

  const totalSize = table.getTotalSize();
  useLayoutEffect(() => onTotalSize?.(totalSize), [totalSize, onTotalSize]);
  return (
    <table
      className="w-full table-fixed border-separate border-spacing-0 text-left text-sm"
      style={{
        minWidth: table.getTotalSize(),
        maxWidth: reserveRight > 0 ? `calc(100% - ${reserveRight}px)` : undefined,
      }}
      aria-labelledby="cut-list-title"
      aria-rowcount={items.length + 1}
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
          {headers.map((h) => {
            const sortable = SORTABLE.has(h.id);
            const key = h.id as SortKey;
            const state = sortable ? ariaSort(sort, key) : undefined;
            const content = h.isPlaceholder ? null : <table.FlexRender header={h} />;
            return (
              <th
                key={h.id}
                scope="col"
                aria-sort={state}
                data-testid={h.id.startsWith('edge-') ? `edge-col-${h.id.slice(5)}` : undefined}
                className={cn(
                  'sticky top-0 z-10 h-9 border-b border-border bg-surface-subtle px-2 text-xs font-medium whitespace-nowrap text-fg-muted',
                  sortable && 'px-0.5',
                  NUMERIC.has(h.id) && 'text-right',
                )}
              >
                {sortable ? (
                  <button
                    type="button"
                    data-testid={`sort-${h.id}`}
                    onClick={() => onSort(key)}
                    className={cn(
                      'relative flex h-7 w-full min-w-0 items-center rounded-sm px-1.5 outline-none hover:bg-surface-hover hover:text-fg',
                      NUMERIC.has(h.id) && 'justify-end',
                      state && 'text-fg',
                      focusRing,
                    )}
                  >
                    <span className="truncate">{content}</span>
                    {/* The arrow floats in the free side of the cell: the text never truncates. */}
                    {state ? (
                      <span
                        aria-hidden
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 text-accent-text',
                          NUMERIC.has(h.id) ? 'left-0.5' : 'right-0.5',
                        )}
                      >
                        {state === 'ascending' ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <span className="block truncate">{content}</span>
                )}
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
            );
          })}
        </tr>
      </thead>
      <tbody>
        {padTop > 0 ? (
          <tr aria-hidden>
            <td colSpan={colCount} style={{ height: padTop, padding: 0 }} />
          </tr>
        ) : null}
        {rowEls}
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
  order,
  ctx,
  scrollRef,
  scrollToRow,
}: {
  t: Text;
  parts: readonly Part[];
  /** Project indexes in view order (T123: search, sort, filter; no group headers on phones). */
  order: readonly number[];
  ctx: { current: GridContext };
  scrollRef: { current: HTMLDivElement | null };
  scrollToRow: { current: ((row: number) => void) | null };
}) {
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer re-renders this component itself
  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 4,
    initialRect: { width: 390, height: 640 },
  });
  scrollToRow.current = (row) => {
    const position = order.indexOf(row);
    if (position >= 0) virtualizer.scrollToIndex(position, { align: 'auto' });
  };
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
        const row = order[v.index] ?? -1;
        const part = parts[row];
        if (!part) return null;
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
  const total = ctx.visibleIds().length;
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
  issuesPanel,
  issuesKey,
  initialSelection,
  onSelectionChange,
  dxfText,
  holeTool,
}: {
  t: Text;
  project: Project;
  issues: readonly ValidationIssue[];
  run: Run;
  /** Undo of the last command (the "Geri al" action of toasts, T246). */
  onUndo?: () => void;
  /**
   * The Uyarılar panel (T253): it floats on the right from the issue chip, so the grid never
   * moves or changes its columns when the first issue appears.
   */
  issuesPanel?: ReactNode;
  /** Project id: a closed Uyarılar panel is remembered per project (T256). */
  issuesKey?: string | undefined;
  /** Selected part ids when the grid opens (shared with the drawing board, T135). */
  initialSelection?: readonly string[];
  /** Reports every selection change (Liste ↔ Çizim keep one selection, T135). */
  onSelectionChange?: (ids: string[]) => void;
  /** Text of the DXF import dialog (T146); without it the button is hidden. */
  dxfText?: Messages['dxfImport'];
  /** Tool number for holes made from DXF circles on a "Delik" layer (T145). */
  holeTool?: number;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dxfOpen, setDxfOpen] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [cabinetOpen, setCabinetOpen] = useState(0);
  // T253 + T256: the Uyarılar panel floats from the issue chip. It opens by itself (when the first
  // issue appears, or on a step entered with issues) only where it fits right of the last grid
  // column without covering a cell or header: there the grid always keeps that gutter free, so it
  // never moves when issues come. Elsewhere it stays closed behind the chip. Once the user closes
  // it, it stays closed for the project (remembered across reloads) until a new issue type shows.
  const [issuesOpen, setIssuesOpen] = useState(false);
  const hasIssues = issues.length > 0 && issuesPanel !== undefined;
  const [issuesShown, setIssuesShown] = useState(false);
  const [dismissed, setDismissed] = useState<string[] | null>(() => readDismissed(issuesKey));
  const [gridTotal, setGridTotal] = useState(0);
  const issueCodes = useMemo(() => [...new Set(issues.map((i) => i.code))], [issues]);
  // A new project gets its id on the first save: a panel closed before that is remembered then.
  useEffect(() => {
    if (issuesKey && dismissed) writeDismissed(issuesKey, dismissed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the id arrives
  }, [issuesKey]);
  function closeIssues() {
    setIssuesOpen(false);
    setDismissed(issueCodes);
    writeDismissed(issuesKey, issueCodes);
  }
  const issuesContent = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set(initialSelection ?? []),
  );
  const anchor = useRef<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToRow = useRef<((row: number) => void) | null>(null);
  const phone = !useMediaQuery('(min-width: 640px)');
  const width = useWidth(scrollRef);
  const wideBands = !phone && width >= WIDE_BANDS_MIN;
  const narrow = !phone && width > 0 && width < NARROW_GRID_MAX;
  const issuesFit =
    issuesPanel !== undefined &&
    !phone &&
    gridTotal > 0 &&
    width >= gridTotal + ISSUES_PANEL_PX + ISSUES_GAP_PX;
  // State follows props during render (no effect): open once per run of issues.
  if (
    hasIssues &&
    !issuesOpen &&
    (!issuesShown || dismissed !== null) &&
    mayAutoOpen(issuesFit, issueCodes, dismissed)
  ) {
    setIssuesShown(true);
    setIssuesOpen(true);
  } else if (!hasIssues && (issuesShown || issuesOpen)) {
    setIssuesShown(false);
    setIssuesOpen(false);
  }

  const parts = project.parts;
  const summary = cutListSummary(project);
  const cols = useMemo(() => navColumns(wideBands, !narrow), [wideBands, narrow]);

  // T123: the view (search, sort, filter, groups). It never changes the project order.
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const issueSet = useMemo(() => issueRows(issues), [issues]);
  const view = useMemo(
    () => cutListView(parts, issueSet, { query, sort, issuesOnly, grouped, collapsed }),
    [parts, issueSet, query, sort, issuesOnly, grouped, collapsed],
  );
  const order = view.order;
  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function resetView() {
    setQuery('');
    setSort(null);
    setIssuesOnly(false);
    setCollapsed(new Set());
  }
  // Ids of removed parts drop out of the selection (undo, delete, another screen).
  const selected = useMemo(() => {
    const have = new Set(parts.map((p) => p.id));
    return parts.filter((p) => selection.has(p.id) && have.has(p.id)).map((p) => p.id);
  }, [parts, selection]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const reportSelection = useRef(onSelectionChange);
  reportSelection.current = onSelectionChange;
  useEffect(() => reportSelection.current?.(selected), [selected]);

  // The cell a keyboard move is still heading for (its row is mounting). A key that arrives
  // meanwhile moves on from there, not from the cell that still has focus, so 40 fast ArrowDowns
  // land on row 41 at any key rate (B7 r2).
  const pendingFocus = useRef<{ row: number; col: string } | null>(null);

  /** Focuses a cell, scrolling its row into view first when it is not rendered yet. */
  function focusCell(row: number, col: string, tries = 3) {
    const el = document.getElementById(cellId(row, col));
    if (el) {
      pendingFocus.current = null;
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
      return;
    }
    if (tries === 0) {
      pendingFocus.current = null;
      return;
    }
    const target = { row, col };
    pendingFocus.current = target;
    scrollToRow.current?.(row);
    requestAnimationFrame(() => {
      // A newer move took over: it has its own retries.
      if (pendingFocus.current === target) focusCell(row, col, tries - 1);
    });
  }

  useEffect(() => {
    if (focusNext.current) {
      const [row, col] = focusNext.current.split('|');
      focusNext.current = null;
      focusCell(Number(row), col ?? 'name');
    }
  });

  // T261: a row that Enter appended on the last row and the user never edited is a phantom; it
  // is removed when focus leaves it or the grid goes away (step change, Liste → Çizim). Rows from
  // "Satır ekle" are kept. Any command that names the row (an edit) makes it a real row.
  const phantom = useRef<string | null>(null);
  // The parts list right after the phantom was added: unchanged since → the add is the last
  // step, so it is taken back with undo (no extra history step to undo later).
  const phantomParts = useRef<readonly Part[] | null>(null);
  const undoRef = useRef(onUndo);
  useEffect(() => {
    undoRef.current = onUndo;
  });
  useEffect(() => {
    const id = phantom.current;
    if (id && phantomParts.current === null && parts.some((p) => p.id === id)) {
      phantomParts.current = parts;
    }
  });
  function dropPhantom() {
    const id = phantom.current;
    if (!id) return;
    phantom.current = null;
    const at = phantomParts.current;
    phantomParts.current = null;
    const part = latest.current.parts.find((p) => p.id === id);
    if (!part || !untouchedNewRow(part)) return;
    if (latest.current.parts === at && undoRef.current) undoRef.current();
    else latest.current.run('removeParts', { ids: [id] });
  }
  useEffect(() => () => dropPhantom(), []);

  function addRow(col = 'name', fromEnter = false) {
    const id = newPartId();
    const ok = run('addPart', {
      id,
      name: fill(t.defaultName, { n: parts.length + 1 }),
      params: { w: 100, h: 100, r: 0 },
    });
    if (ok) {
      if (fromEnter) {
        phantom.current = id;
        phantomParts.current = null;
      }
      // The new row has no group and no issue yet: drop what would hide it (T123).
      setQuery('');
      setIssuesOnly(false);
      if (collapsed.has('')) toggleGroup('');
      focusNext.current = `${parts.length}|${col}`;
      scrollToRow.current?.(parts.length);
    }
  }

  const navigate: Navigate = (row: number, col: string, dir: NavDirection, enter = false) => {
    const from = pendingFocus.current ?? { row, col };
    // Rows move in view order (T123); cell ids keep the project index.
    const position = order.indexOf(from.row);
    if (position < 0) return;
    const target = navTarget(position, from.col, dir, order.length, cols, enter);
    if (!target) return;
    if ('append' in target) addRow(target.col === 'actions' ? 'name' : target.col, true);
    else focusCell(order[target.row] ?? 0, target.col);
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
    // Ranges follow the view order (T123).
    const anchorRow = anchor.current ? parts.findIndex((p) => p.id === anchor.current) : -1;
    const from = order.indexOf(anchorRow);
    const to = order.indexOf(row);
    if (mods.shift && from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      const range = order.slice(a, b + 1).map((i) => parts[i]?.id ?? '');
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
    order,
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
    order,
    issuesOf,
    act,
    targetIds,
    selectClick,
    selectedSet,
    setSelection,
  };
  const rowMenu = useRef<((row: number, anchor: HTMLElement) => void) | null>(null);
  const ctx = useMemo(
    () => ({
      current: {
        t,
        run: (name: string, params: unknown) => {
          if (phantom.current && namesPart(params, phantom.current)) phantom.current = null;
          return latest.current.run(name, params);
        },
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
        visibleIds: () =>
          latest.current.order.flatMap((i) => {
            const id = latest.current.parts[i]?.id;
            return id ? [id] : [];
          }),
        selectAll: (on: boolean) =>
          latest.current.setSelection(
            new Set(
              on
                ? latest.current.order.flatMap((i) => {
                    const id = latest.current.parts[i]?.id;
                    return id ? [id] : [];
                  })
                : [],
            ),
          ),
        openRowMenu: (row: number, anchor: HTMLElement) => rowMenu.current?.(row, anchor),
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

  /** T122: the generated rows in one importCutList = one undo step (D-041). */
  function addCabinet(generated: Parameters<typeof cabinetRows>[0], group: string): boolean {
    const rows = cabinetRows(generated, t.cabinet.roles, group, newPartId, project.stock.thickness);
    const ok = run('importCutList', { parts: rows });
    if (ok) {
      notify.success(
        fill(t.cabinet.added, { group: group.trim() || t.cabinet.title, count: rows.length }),
        {
          id: 'cut-list-cabinet',
          ...undoAction,
        },
      );
      scrollToRow.current?.(parts.length);
    }
    return ok;
  }

  /** T146: the parts confirmed in the DXF dialog, one importDxf = one undo step. */
  function addDxf(params: { parts: unknown[] }, fileName: string, count: number): boolean {
    const ok = run('importDxf', params);
    if (ok && dxfText) {
      notify.success(fill(dxfText.added, { file: fileName, count }), {
        id: 'cut-list-dxf',
        ...undoAction,
      });
      scrollToRow.current?.(parts.length);
    } else if (dxfText) {
      notify.error(dxfText.failed);
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
  const v = t.view;
  const filtering = query.trim() !== '' || issuesOnly;

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

      <Popover
        open={issuesOpen && hasIssues}
        onOpenChange={(open) => (open ? setIssuesOpen(true) : closeIssues())}
      >
        <section
          aria-labelledby="cut-list-title"
          data-density="compact"
          onKeyDown={onGridKey}
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs"
        >
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
            {selected.length > 0 ? (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2"
                data-testid="selection-bar"
              >
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
                  <IconButton
                    size="sm"
                    aria-label={s.clear}
                    onClick={() => setSelection(new Set())}
                  >
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
                  <IssuesOkChip label={t.issueChip.ok} testId="cut-list-issue-chip" />
                ) : (
                  <button
                    type="button"
                    data-testid="cut-list-issue-chip"
                    data-count={problemCount}
                    aria-expanded={issuesPanel ? issuesOpen : undefined}
                    aria-controls={issuesPanel && issuesOpen ? 'cut-list-issues' : undefined}
                    onClick={() => {
                      if (issuesOpen) {
                        closeIssues();
                        return;
                      }
                      setIssuesOpen(true);
                      // Keyboard users land in the panel; Esc there closes it.
                      requestAnimationFrame(() =>
                        issuesContent.current?.querySelector<HTMLElement>('h2 button')?.focus(),
                      );
                    }}
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
              <Tooltip content={t.cabinet.openHint}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCabinetOpen((n) => n + 1)}
                  data-testid="cabinet-open"
                  aria-label={phone ? t.cabinet.open : undefined}
                >
                  <Archive aria-hidden />
                  <span className="max-sm:sr-only">{t.cabinet.open}</span>
                </Button>
              </Tooltip>
              {dxfText ? (
                <Tooltip content={dxfText.openHint}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDxfOpen((n) => n + 1)}
                    data-testid="dxf-open"
                    aria-label={phone ? dxfText.open : undefined}
                  >
                    <FileUp aria-hidden />
                    <span className="max-sm:sr-only">{dxfText.open}</span>
                  </Button>
                </Tooltip>
              ) : null}
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
          {parts.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2"
              data-testid="cut-list-view"
            >
              <div className="relative w-full sm:w-56 xl:w-72">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
                />
                <Input
                  type="search"
                  inputSize="sm"
                  aria-label={v.search}
                  placeholder={v.searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && query !== '') {
                      e.stopPropagation();
                      setQuery('');
                    }
                  }}
                  className="pl-8"
                  data-testid="cut-list-search"
                />
              </div>
              <Tooltip content={v.groupHint}>
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={grouped}
                  onClick={() => setGrouped((g) => !g)}
                  className={cn(grouped && PRESSED)}
                  data-testid="cut-list-group-by"
                >
                  <Layers aria-hidden />
                  {v.group}
                </Button>
              </Tooltip>
              <Tooltip content={v.issuesOnlyHint}>
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={issuesOnly}
                  onClick={() => setIssuesOnly((on) => !on)}
                  className={cn(issuesOnly && PRESSED)}
                  data-testid="cut-list-issues-only"
                >
                  <TriangleAlert aria-hidden />
                  {v.issuesOnly}
                  {issueSet.size > 0 ? (
                    <span className="text-xs text-fg-muted tabular-nums">{issueSet.size}</span>
                  ) : null}
                </Button>
              </Tooltip>
              <span className="flex-1" />
              {filtering || sort ? (
                <>
                  <span
                    role="status"
                    className="text-xs text-fg-muted tabular-nums"
                    data-testid="cut-list-shown"
                  >
                    {fill(v.shown, { shown: view.matched, total: parts.length })}
                  </span>
                  <Tooltip content={v.viewOnlyHint}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetView}
                      data-testid="cut-list-reset"
                    >
                      <X aria-hidden />
                      <span className={narrow ? 'sr-only' : undefined}>{v.reset}</span>
                    </Button>
                  </Tooltip>
                </>
              ) : null}
            </div>
          ) : null}
          {issuesPanel ? (
            <>
              {/* The panel hangs from the right edge under the view bar, over the grid (T253). */}
              <PopoverAnchor aria-hidden className="h-0" />
              <PopoverContent
                ref={issuesContent}
                id="cut-list-issues"
                aria-label={t.issuesPanel.label}
                role="dialog"
                side="bottom"
                align="end"
                data-testid="cut-list-issues"
                className="max-h-[min(32rem,calc(100dvh-14rem))] w-[22rem] max-w-[calc(100vw-2rem)] overflow-auto border-0 bg-transparent p-0 shadow-lg"
                // Non-modal and quiet: it never takes focus by itself and stays open while
                // the user keeps typing in the grid; the chip or Esc inside it closes it.
                onOpenAutoFocus={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => {
                  if (!issuesContent.current?.contains(document.activeElement)) e.preventDefault();
                }}
              >
                {issuesPanel}
              </PopoverContent>
            </>
          ) : null}
          {dxfOpen > 0 && dxfText ? (
            <DxfImportDialog
              key={dxfOpen}
              t={dxfText}
              open
              onOpenChange={(o) => {
                if (!o) setDxfOpen(0);
              }}
              onImport={addDxf}
              newId={newPartId}
              {...(holeTool !== undefined ? { holeTool } : {})}
              thickness={project.stock.thickness}
            />
          ) : null}
          {cabinetOpen > 0 ? (
            <CabinetDialog
              key={cabinetOpen}
              t={t.cabinet}
              open
              onOpenChange={(o) => {
                if (!o) setCabinetOpen(0);
              }}
              thickness={project.stock.thickness}
              hasGrain={stockHasGrain(project.stock)}
              defaultGroup={nextCabinetName(
                t.cabinet.defaultGroup,
                parts.map((p) => p.group),
              )}
              onAdd={addCabinet}
            />
          ) : null}
          {selected.length > 0 ? (
            // The title stays the section's name while the selection bar replaces it.
            <h2 id="cut-list-title" className="sr-only">
              {t.tableLabel}
            </h2>
          ) : null}
          <div
            ref={scrollRef}
            onBlur={(e) => {
              const id = phantom.current;
              if (!id) return;
              const from = rowIdOf(e.target);
              if (from !== id || rowIdOf(e.relatedTarget) === id) return;
              // Undo / redo take the row back themselves; dropping it first would make the
              // click undo the drop instead (the row would seem to come back).
              const to = e.relatedTarget;
              if (to instanceof Element && to.closest('[data-history]')) return;
              dropPhantom();
            }}
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
            ) : view.items.length === 0 ? (
              <div
                className="flex flex-col items-center gap-3 px-6 py-10 text-center"
                data-testid="cut-list-no-match"
              >
                <p className="text-sm text-fg-muted">{v.noMatch}</p>
                <Button variant="outline" size="sm" onClick={resetView}>
                  {v.reset}
                </Button>
              </div>
            ) : phone ? (
              <Cards
                t={t}
                parts={parts}
                order={order}
                ctx={ctx}
                scrollRef={scrollRef}
                scrollToRow={scrollToRow}
              />
            ) : (
              <Grid
                t={t}
                parts={parts}
                items={view.items}
                ctx={ctx}
                wideBands={wideBands}
                narrow={narrow}
                scrollRef={scrollRef}
                scrollToRow={scrollToRow}
                sort={sort}
                onSort={(key) => setSort((prev) => nextSort(prev, key))}
                onToggleGroup={toggleGroup}
                reserveRight={issuesFit ? ISSUES_PANEL_PX + ISSUES_GAP_PX : 0}
                onTotalSize={setGridTotal}
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
              <IconButton
                size="sm"
                aria-label={t.summary.shortcuts}
                data-testid="cut-list-shortcuts"
              >
                <Keyboard aria-hidden />
              </IconButton>
            </Tooltip>
          </footer>
        </section>
      </Popover>
      <RowMenu t={t} openerRef={rowMenu} rowAction={ctx.current.rowAction} canMove={!sort} />
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
