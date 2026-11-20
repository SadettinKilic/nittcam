'use client';

import {
  Button,
  Checkbox,
  IconButton,
  Tooltip,
  Popover,
  PopoverContent,
  PopoverTrigger,
  formatMeasure,
} from '@nittcam/ui';
import { CircleHelp, Magnet } from 'lucide-react';
import { openShortcuts } from '../../lib/shortcuts';
import { useId } from 'react';
import type { Messages } from '../../lib/messages';
import { SNAP_TOGGLES, type SnapToggle } from '../../lib/editor/store';
import { zoomPercent, type Pt } from '../../lib/editor/viewport';

/**
 * Status bar under the drawing board (T124): cursor X/Y in mono, snap toggles, zoom %, units.
 */
export function StatusBar({
  t,
  cursor,
  scale,
  snap,
  onSnap,
  hint = null,
  snapName = null,
}: {
  t: Messages['editor'];
  cursor: Pt | null;
  scale: number;
  snap: Record<SnapToggle, boolean>;
  onSnap: (kind: SnapToggle, on: boolean) => void;
  /** Next-step hint of the active drawing tool (D-039); replaces the "İmleç" label. */
  hint?: string | null;
  /** Name of the snapped kind while drawing ("Uç nokta"). */
  snapName?: string | null;
}) {
  const id = useId();
  const on = SNAP_TOGGLES.filter((k) => snap[k]).length;
  const fmt = (v: number) => formatMeasure(v, { decimals: 1 });
  return (
    <div
      role="status"
      aria-label={t.status.label}
      className="flex h-9 items-center gap-3 px-3 font-mono text-2xs text-fg-muted tabular-nums"
      data-testid="editor-status"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2" data-testid="editor-cursor">
        {hint ? (
          <span
            className="line-clamp-2 font-sans leading-tight whitespace-normal text-fg"
            title={hint}
            data-testid="editor-hint"
          >
            {hint}
          </span>
        ) : (
          <span className="font-sans max-sm:hidden">{t.status.cursor}</span>
        )}
        {snapName ? (
          <span className="shrink-0 font-sans text-info-text" data-testid="editor-snap-name">
            {snapName}
          </span>
        ) : null}
        {/* Phones (T240): no hover, so no cursor read-out; snap toggle + zoom % only. */}
        <span className="shrink-0 max-sm:hidden">X {cursor ? fmt(cursor.x) : '—'}</span>
        <span className="shrink-0 max-sm:hidden">Y {cursor ? fmt(cursor.y) : '—'}</span>
      </span>
      <span className="ml-auto" />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 font-sans text-2xs"
            data-testid="editor-snap-menu"
          >
            <Magnet aria-hidden />
            {on > 0 ? `${t.status.snap} · ${on}` : t.status.snapOff}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-3" data-density="compact">
          <p className="mb-2 text-xs font-semibold text-fg">{t.status.snap}</p>
          <ul className="flex flex-col gap-1.5">
            {SNAP_TOGGLES.map((kind) => (
              <li key={kind} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={`${id}-${kind}`}
                  checked={snap[kind]}
                  onCheckedChange={(v) => onSnap(kind, v === true)}
                />
                <label htmlFor={`${id}-${kind}`} className="cursor-pointer">
                  {t.snap[kind]}
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-subtle">{t.status.snapHint}</p>
        </PopoverContent>
      </Popover>
      <span aria-label={t.status.zoom} data-testid="editor-zoom">
        %{zoomPercent(scale)}
      </span>
      <span className="font-sans max-sm:hidden">{t.status.units}</span>
      {/* T242: the board's shortcut list lives in the shortcuts dialog ("Çizim tahtası"). */}
      <Tooltip content={`${t.status.shortcuts} · ?`}>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t.status.shortcuts}
          aria-haspopup="dialog"
          className="-mr-2 size-7"
          data-testid="editor-shortcuts"
          onClick={() => openShortcuts('board')}
        >
          <CircleHelp aria-hidden />
        </IconButton>
      </Tooltip>
    </div>
  );
}
