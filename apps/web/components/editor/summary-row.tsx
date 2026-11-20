'use client';

/**
 * A collapsed summary row of the properties panel (B50, polish P1): one line with a chevron
 * ("Delik 3 · Geçme · Ø35 · T2"), a trailing action (delete), and the fields below it when open.
 * Notes that must stay visible (errors, warnings) go in `notes`, outside the collapsed part.
 */
import { cn, focusRing } from '@nittcam/ui';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';

export function SummaryRow({
  title,
  summary,
  open,
  onToggle,
  error = false,
  badge,
  action,
  notes,
  children,
  testId,
  dataError,
}: {
  title: string;
  /** Short facts after the title, muted ("Geçme · Ø35 · T2"). */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  error?: boolean;
  badge?: ReactNode;
  action?: ReactNode;
  notes?: ReactNode;
  children: ReactNode;
  testId: string;
  dataError?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="flex flex-col" data-testid={testId} data-error={dataError} data-open={open}>
      <div className="flex min-h-8 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          data-testid={`${testId}-toggle`}
          onClick={onToggle}
          className={cn(
            '-ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 py-1 text-left text-xs',
            error ? 'text-danger-text' : 'text-fg-muted hover:text-fg',
            focusRing,
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-(--duration-fast)',
              open && 'rotate-90',
            )}
          />
          {error ? <CircleAlert aria-hidden className="size-3.5 shrink-0" /> : null}
          <span className="shrink-0 font-medium">{title}</span>
          {summary ? <span className="truncate">· {summary}</span> : null}
        </button>
        {badge}
        {action}
      </div>
      {notes}
      <div id={id} hidden={!open} className="flex flex-col pb-1">
        {children}
      </div>
    </div>
  );
}
