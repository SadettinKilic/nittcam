'use client';

import {
  Button,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  formatMeasure,
} from '@nittcam/ui';
import { Magnet } from 'lucide-react';
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
}: {
  t: Messages['editor'];
  cursor: Pt | null;
  scale: number;
  snap: Record<SnapToggle, boolean>;
  onSnap: (kind: SnapToggle, on: boolean) => void;
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
      <span className="flex min-w-0 items-center gap-2" data-testid="editor-cursor">
        <span className="font-sans">{t.status.cursor}</span>
        <span>X {cursor ? fmt(cursor.x) : '—'}</span>
        <span>Y {cursor ? fmt(cursor.y) : '—'}</span>
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
      <span className="font-sans">{t.status.units}</span>
    </div>
  );
}
