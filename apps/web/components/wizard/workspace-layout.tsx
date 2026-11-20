'use client';

import {
  Button,
  IconButton,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tooltip,
  cn,
} from '@nittcam/ui';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  SquareMousePointer,
} from 'lucide-react';
import { useMediaQuery, WORKSPACE_DESKTOP } from '../../lib/use-media-query';
import { useId, useState, type ReactNode } from 'react';
import { readPanelOpen, writePanelOpen, type PanelSide } from '../../lib/workspace-panels';

export interface WorkspaceLabels {
  /** Accessible name of the left settings panel ("Ayarlar"). */
  left: string;
  /** Accessible name of the right inspector ("Parça / G-code"). */
  right: string;
  collapseLeft: string;
  expandLeft: string;
  collapseRight: string;
  expandRight: string;
  /** Phone/tablet bar buttons that open the panels as bottom sheets (T198). */
  openLeft: string;
  openRight: string;
  close: string;
}

export interface WorkspaceLayoutProps {
  labels: WorkspaceLabels;
  /** Settings panel (232 px on desktop, collapsible, compact density). */
  left?: ReactNode;
  /** Desktop panel header next to the collapse button (default: the panel's name). */
  leftHeader?: ReactNode;
  rightHeader?: ReactNode;
  /** The drawing; it fills the remaining viewport height on ≥ 1024 px. */
  canvas: ReactNode;
  /** Inspector (264 px, collapsible): selected part, G-code. */
  right?: ReactNode;
  /** Floating controls on top of the canvas (toolbars, legend, scale), positioned by the caller. */
  canvasOverlay?: ReactNode;
  /** Docked under the canvas inside the canvas column (simulation transport, depth strip). */
  canvasFooter?: ReactNode;
  /** Below 1024 px: the main action next to the panel buttons (e.g. "Diz"), never scrolled away. */
  compactAction?: ReactNode;
  testId?: string;
}

/**
 * Canvas-first workspace for Dizilim and Simülasyon (T197, spec §3.6), the base the drawing board
 * (T124) and the 3D preview (T152, T160) plug into. Slots: `left`, `canvas`, `right`,
 * `canvasOverlay` (+ `canvasFooter`). On ≥ 1024 px the three columns fill the viewport height and
 * only the panels scroll; the page itself does not.
 */
export function WorkspaceLayout({
  labels,
  left,
  canvas,
  right,
  leftHeader,
  rightHeader,
  canvasOverlay,
  canvasFooter,
  compactAction,
  testId = 'workspace',
}: WorkspaceLayoutProps) {
  const desktop = useMediaQuery(WORKSPACE_DESKTOP);
  const [sheet, setSheet] = useState<'left' | 'right' | null>(null);
  const leftId = useId();
  const rightId = useId();
  // T241: one remembered open/collapsed state per side for every workspace; the left panel
  // starts collapsed below 1280 px. Workspaces mount on the client only (after the wizard's
  // data loaded), so the stored state is read in the initialiser.
  const initial = (side: PanelSide) =>
    typeof window === 'undefined' ? true : readPanelOpen(side, window.innerWidth);
  const [leftOpen, setLeftOpen] = useState(() => initial('left'));
  const [rightOpen, setRightOpen] = useState(() => initial('right'));
  const toggle = (side: PanelSide) => () => {
    const set = side === 'left' ? setLeftOpen : setRightOpen;
    set((o) => {
      writePanelOpen(side, !o);
      return !o;
    });
  };
  const hasLeft = left !== undefined && left !== null;
  const hasRight = right !== undefined && right !== null;

  const canvasColumn = (extra: string, canvasMin = 'min-h-[220px]') => (
    <div
      data-testid={`${testId}-canvas`}
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-canvas',
        extra,
      )}
    >
      <div className={cn('relative min-w-0 flex-1', canvasMin)}>
        {canvas}
        {canvasOverlay}
      </div>
      {canvasFooter ? (
        <div className="shrink-0 border-t border-border bg-surface">{canvasFooter}</div>
      ) : null}
    </div>
  );

  if (!desktop) {
    // T198: canvas first (≥ 55 % of the viewport), panels as bottom sheets. Phones get a
    // two-button bar under the canvas; tablets (≥ 768 px) an icon rail beside it.
    const open = (side: 'left' | 'right') => () => setSheet(side);
    const panelButton = (side: 'left' | 'right', rail: boolean) => {
      const label = side === 'left' ? labels.openLeft : labels.openRight;
      const Icon = side === 'left' ? SlidersHorizontal : SquareMousePointer;
      if ((side === 'left' && !hasLeft) || (side === 'right' && !hasRight)) return null;
      return rail ? (
        <Tooltip content={label} side="right">
          <IconButton
            variant="outline"
            aria-label={label}
            aria-haspopup="dialog"
            data-testid={`workspace-rail-${side}`}
            onClick={open(side)}
          >
            <Icon aria-hidden />
          </IconButton>
        </Tooltip>
      ) : (
        <Button
          variant="outline"
          aria-haspopup="dialog"
          data-testid={`workspace-open-${side}`}
          onClick={open(side)}
          className="min-w-0 flex-1"
        >
          <Icon aria-hidden />
          <span className="truncate">{label}</span>
        </Button>
      );
    };
    const panelSheet = (side: 'left' | 'right', body: ReactNode) => (
      <Sheet open={sheet === side} onOpenChange={(o) => setSheet(o ? side : null)}>
        <SheetContent
          side="bottom"
          closeLabel={labels.close}
          data-testid={`workspace-sheet-${side}`}
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle>{side === 'left' ? labels.left : labels.right}</SheetTitle>
          </SheetHeader>
          <SheetBody data-density="compact" className="flex flex-col gap-3 pb-4">
            {body}
          </SheetBody>
        </SheetContent>
      </Sheet>
    );
    return (
      <div data-testid={testId} data-mode="compact" className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 gap-2">
          <div
            role="toolbar"
            aria-orientation="vertical"
            aria-label={labels.left}
            className="hidden shrink-0 flex-col gap-1 md:flex"
            data-testid="workspace-rail"
          >
            {panelButton('left', true)}
            {panelButton('right', true)}
          </div>
          {/* T199b: with a docked footer (simulation transport) the drawing itself keeps a usable
              height on phones instead of sharing 55 dvh with the footer. */}
          {/* T240 (D-039): below 640 px the column fills the viewport between the one-row wizard
              header and the panel bar + footer (≥ 55 % of the height); the drawing of a
              workspace with a docked footer keeps ≥ 55 % itself and the page scrolls to it. */}
          {canvasFooter
            ? canvasColumn(
                'min-h-[max(55dvh,280px)] flex-1 max-sm:min-h-[max(calc(100dvh-12rem-var(--wizard-footer-h,4.25rem)),280px)]',
                'min-h-[max(55dvh,260px)]',
              )
            : canvasColumn(
                'h-[max(62dvh,280px)] flex-1 max-sm:h-[max(calc(100dvh-12rem-var(--wizard-footer-h,4.25rem)),280px)]',
              )}
        </div>
        {/* B4b: on short phones the panel bar sticks just above the sticky wizard footer
            (its height, incl. the safe area, is published as --wizard-footer-h). */}
        <div
          data-testid="workspace-panel-bar"
          className="sticky bottom-[calc(var(--wizard-footer-h,4.25rem)+0.25rem)] z-10 -my-1 flex items-center gap-2 bg-bg/90 py-1 backdrop-blur-sm md:static md:my-0 md:justify-end md:bg-transparent md:py-0 md:backdrop-blur-none"
        >
          <div className="flex min-w-0 flex-1 gap-2 md:hidden">
            {panelButton('left', false)}
            {panelButton('right', false)}
          </div>
          {compactAction}
        </div>
        {hasLeft ? panelSheet('left', left) : null}
        {hasRight ? panelSheet('right', right) : null}
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      data-left={hasLeft ? (leftOpen ? 'open' : 'closed') : 'none'}
      data-right={hasRight ? (rightOpen ? 'open' : 'closed') : 'none'}
      className={cn(
        'flex min-w-0 flex-col gap-4 lg:grid lg:h-full lg:min-h-0 lg:gap-2',
        'lg:grid-cols-[auto_minmax(0,1fr)_auto]',
      )}
    >
      {hasLeft ? (
        <SidePanel
          id={leftId}
          side="left"
          open={leftOpen}
          label={labels.left}
          header={leftHeader}
          collapse={labels.collapseLeft}
          expand={labels.expandLeft}
          onToggle={toggle('left')}
        >
          {left}
        </SidePanel>
      ) : (
        <div className="hidden lg:block" />
      )}

      {canvasColumn('')}

      {hasRight ? (
        <SidePanel
          id={rightId}
          side="right"
          open={rightOpen}
          label={labels.right}
          header={rightHeader}
          collapse={labels.collapseRight}
          expand={labels.expandRight}
          onToggle={toggle('right')}
        >
          {right}
        </SidePanel>
      ) : (
        <div className="hidden lg:block" />
      )}
    </div>
  );
}

function SidePanel({
  id,
  side,
  open,
  label,
  header,
  collapse,
  expand,
  onToggle,
  children,
}: {
  id: string;
  side: 'left' | 'right';
  open: boolean;
  label: string;
  header?: ReactNode;
  collapse: string;
  expand: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Icon =
    side === 'left'
      ? open
        ? PanelLeftClose
        : PanelLeftOpen
      : open
        ? PanelRightClose
        : PanelRightOpen;
  return (
    <aside
      aria-label={label}
      data-testid={`workspace-${side}`}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'flex min-w-0 flex-col lg:min-h-0',
        open ? (side === 'left' ? 'lg:w-[232px]' : 'lg:w-[264px]') : 'lg:w-10',
        side === 'left' ? 'order-2 lg:order-none' : 'order-3 lg:order-none',
      )}
    >
      {/* T241: the collapse button sits in the panel's own header row (name / count). */}
      <div
        className={cn(
          'hidden h-9 shrink-0 items-center gap-2 lg:flex',
          open ? 'pl-3' : 'justify-center',
        )}
        data-testid={`workspace-${side}-header`}
      >
        {open ? (
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
            {header ?? <h2 className="truncate text-sm font-semibold text-fg">{label}</h2>}
          </div>
        ) : null}
        <Tooltip content={open ? collapse : expand}>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={open ? collapse : expand}
            aria-expanded={open}
            aria-controls={id}
            data-testid={`workspace-${side}-toggle`}
            onClick={onToggle}
          >
            <Icon aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      <div
        id={id}
        data-density="compact"
        // B44: once scrolled, the top edge fades, so no half-cut row sits under the header.
        onScroll={(e) =>
          e.currentTarget.toggleAttribute('data-scrolled', e.currentTarget.scrollTop > 0)
        }
        className={cn(
          'flex min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain',
          'lg:data-[scrolled]:[mask-image:linear-gradient(to_bottom,transparent,#000_20px)]',
          !open && 'lg:hidden',
        )}
      >
        {children}
      </div>
    </aside>
  );
}
