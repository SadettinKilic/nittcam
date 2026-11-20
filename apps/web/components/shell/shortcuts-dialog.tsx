'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nittcam/ui';
import { useRef } from 'react';
import { OPEN_EDITOR_TOUR_EVENT } from '../../lib/editor/tour';
import type { Messages } from '../../lib/messages';
import { SHORTCUTS, SHORTCUT_GROUPS, type ShortcutGroup } from '../../lib/shortcuts';
import { ShortcutKeys } from './keys';

/**
 * The registered shortcuts, one titled list per group: the "?" dialog and Ayarlar → Görünüm
 * (T183). `prefix` keeps heading ids and test ids apart when both are on screen.
 */
export function ShortcutGroups({
  t,
  groups = SHORTCUT_GROUPS,
  prefix = 'shortcut',
}: {
  t: Messages['shortcuts'];
  groups?: readonly ShortcutGroup[];
  prefix?: string;
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group} aria-labelledby={`${prefix}s-${group}`}>
          <h3 id={`${prefix}s-${group}`} className="mb-1.5 text-xs font-medium text-fg-muted">
            {t.groups[group]}
          </h3>
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <li
                key={s.id}
                data-testid={`${prefix}-${s.id}`}
                className="flex min-h-10 items-center justify-between gap-4 px-3 text-sm"
              >
                <span>{t.items[s.id]}</span>
                <ShortcutKeys id={s.id} then={t.then} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * "?" help: every registered shortcut, grouped (T104). With `group` = 'board' it is the
 * editor's shortcut sheet (T136): the board group only, a link to the full list and the tour.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  t,
  onCloseAutoFocus,
  group = null,
  onShowAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Messages['shortcuts'];
  onCloseAutoFocus?: (event: Event) => void;
  group?: ShortcutGroup | null;
  onShowAll?: () => void;
}) {
  const board = group === 'board';
  // "Turu başlat": the tour opens once the dialog has closed and released its focus trap, so
  // its card gets the focus instead of the button that opened the sheet.
  const startTour = useRef(false);
  const groups = group ? [group] : SHORTCUT_GROUPS;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t.close}
        data-testid="shortcuts-dialog"
        data-group={group ?? 'all'}
        onCloseAutoFocus={(e) => {
          if (startTour.current) {
            startTour.current = false;
            e.preventDefault();
            window.dispatchEvent(new Event(OPEN_EDITOR_TOUR_EVENT));
          } else onCloseAutoFocus?.(e);
        }}
      >
        <DialogHeader>
          <DialogTitle>{board ? t.boardTitle : t.title}</DialogTitle>
          <DialogDescription>{board ? t.boardDescription : t.description}</DialogDescription>
        </DialogHeader>
        {/* Scrollable list: focusable so keyboard users can scroll it (axe scrollable-region-focusable). */}
        <div
          role="region"
          aria-label={t.title}
          tabIndex={0}
          data-testid="shortcuts-list"
          className="-mx-1 flex max-h-[60vh] flex-col gap-5 overflow-y-auto rounded-md px-1 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ShortcutGroups t={t} groups={groups} />
        </div>
        {group ? (
          <DialogFooter className="gap-2 sm:justify-between">
            {board ? (
              <Button
                variant="secondary"
                data-testid="shortcuts-start-tour"
                onClick={() => {
                  startTour.current = true;
                  onOpenChange(false);
                }}
              >
                {t.startTour}
              </Button>
            ) : null}
            <Button variant="ghost" data-testid="shortcuts-show-all" onClick={onShowAll}>
              {t.showAll}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
