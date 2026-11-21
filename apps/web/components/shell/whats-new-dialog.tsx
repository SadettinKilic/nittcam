'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nittcam/ui';
import type { Messages } from '../../lib/messages';

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

/**
 * "Yenilikler" (T192, D-095): what the last releases brought, newest first. Opened from the
 * command palette and the help page; it never opens by itself.
 */
export function WhatsNewDialog({
  open,
  onOpenChange,
  t,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: Messages['whatsNew'];
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t.close}
        data-testid="whats-new-dialog"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {/* Scrollable list: focusable so keyboard users can scroll it (axe scrollable-region-focusable). */}
        <div
          role="region"
          aria-label={t.title}
          tabIndex={0}
          className="-mx-1 flex max-h-[60vh] flex-col gap-5 overflow-y-auto rounded-md px-1 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t.releases.map((r) => (
            <section
              key={r.version}
              aria-labelledby={`whats-new-${r.version}`}
              data-testid="whats-new-release"
              data-version={r.version}
            >
              <h3
                id={`whats-new-${r.version}`}
                className="mb-1.5 flex items-baseline justify-between gap-3 text-sm font-medium text-fg"
              >
                <span>{fill(t.version, { version: r.version })}</span>
                <span className="text-xs font-normal text-fg-muted">{r.date}</span>
              </h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
                {r.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
