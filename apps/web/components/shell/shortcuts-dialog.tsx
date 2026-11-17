'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nittcam/ui';
import type { Messages } from '../../lib/messages';
import { SHORTCUTS, SHORTCUT_GROUPS } from '../../lib/shortcuts';
import { ShortcutKeys } from './keys';

/** "?" help: every registered shortcut, grouped (T104). */
export function ShortcutsDialog({
  open,
  onOpenChange,
  t,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Messages['shortcuts'];
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t.close}
        data-testid="shortcuts-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} aria-labelledby={`shortcuts-${group}`}>
              <h3 id={`shortcuts-${group}`} className="mb-1.5 text-xs font-medium text-fg-muted">
                {t.groups[group]}
              </h3>
              <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <li
                    key={s.id}
                    data-testid={`shortcut-${s.id}`}
                    className="flex min-h-10 items-center justify-between gap-4 px-3 text-sm"
                  >
                    <span>{t.items[s.id]}</span>
                    <ShortcutKeys id={s.id} then={t.then} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
