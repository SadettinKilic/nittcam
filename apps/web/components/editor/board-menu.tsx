'use client';

/**
 * Right-click menu of the drawing board (B52, D-092, CTO #10): duplicate, delete, rotate and
 * "Şablon ekle…" for the part under the cursor. A controlled Radix dropdown anchored at the
 * cursor; every entry runs the same command as its toolbar button or shortcut (one undo step).
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@nittcam/ui';
import { ArrowLeft, Copy, LayoutTemplate, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Messages } from '../../lib/messages';
import { fetchTemplates, type TemplateItem } from '../../lib/templates-api';

type T = Messages['editor']['menu'];

export interface BoardMenuProps {
  t: T;
  /** Template entry name ("{name} v{v}"). */
  instanceText: (item: TemplateItem) => string;
  /** Screen position inside the canvas, px; null = closed. */
  at: { x: number; y: number } | null;
  onClose: () => void;
  /** "Şablon ekle…" only with exactly one part selected. */
  canTemplate: boolean;
  onDuplicate: () => void;
  onRemove: () => void;
  onRotate: () => void;
  onTemplate: (item: TemplateItem) => void;
}

export function BoardMenu({
  t,
  instanceText,
  at,
  onClose,
  canTemplate,
  onDuplicate,
  onRemove,
  onRotate,
  onTemplate,
}: BoardMenuProps) {
  const [items, setItems] = useState<TemplateItem[] | 'loading' | 'error' | null>(null);
  const close = () => {
    setItems(null);
    onClose();
  };
  return (
    <DropdownMenu open={at !== null} onOpenChange={(open) => !open && close()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute size-px"
          style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        aria-label={t.label}
        data-testid="board-menu"
      >
        {items === null ? (
          <>
            <DropdownMenuItem data-testid="board-menu-duplicate" onSelect={onDuplicate}>
              <Copy aria-hidden />
              {t.duplicate}
              <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="board-menu-rotate" onSelect={onRotate}>
              <RotateCw aria-hidden />
              {t.rotate}
              <DropdownMenuShortcut>Shift+R</DropdownMenuShortcut>
            </DropdownMenuItem>
            {canTemplate ? (
              <DropdownMenuItem
                data-testid="board-menu-template"
                onSelect={(e) => {
                  // The menu stays open and lists the templates.
                  e.preventDefault();
                  setItems('loading');
                  void fetchTemplates().then((r) => setItems(r ?? 'error'));
                }}
              >
                <LayoutTemplate aria-hidden />
                {t.template}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive data-testid="board-menu-remove" onSelect={onRemove}>
              <Trash2 aria-hidden />
              {t.remove}
              <DropdownMenuShortcut>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              data-testid="board-menu-back"
              onSelect={(e) => {
                e.preventDefault();
                setItems(null);
              }}
            >
              <ArrowLeft aria-hidden />
              {t.back}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {items === 'loading' ? (
              <DropdownMenuItem disabled>{t.loading}</DropdownMenuItem>
            ) : items === 'error' ? (
              <DropdownMenuItem disabled>{t.loadError}</DropdownMenuItem>
            ) : items.length === 0 ? (
              <DropdownMenuItem disabled>{t.empty}</DropdownMenuItem>
            ) : (
              items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  data-testid="board-menu-template-item"
                  onSelect={() => onTemplate(item)}
                >
                  <LayoutTemplate aria-hidden />
                  {instanceText(item)}
                </DropdownMenuItem>
              ))
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
