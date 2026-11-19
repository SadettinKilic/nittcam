'use client';

import { CircleAlert, Inbox, RotateCw } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '../lib/cn';
import { Button } from './button';

/* ---------------------------------------------------------------- notify (toasts) */

export interface NotifyOptions {
  description?: ReactNode;
  /** One action button in the toast (e.g. "Tekrar dene"). */
  action?: { label: string; onClick: () => void };
  /** ms; errors stay longer by default. */
  duration?: number;
  /** Same id = the toast is updated instead of stacked. */
  id?: string | number;
  /**
   * Where this toast shows (default: the Toaster's, bottom right). `bottom-center` keeps a toast
   * off the right-hand inspector while the user works in it (T266).
   */
  position?: 'bottom-right' | 'bottom-center';
}

function options(opts: NotifyOptions, fallbackDuration: number) {
  return {
    duration: opts.duration ?? fallbackDuration,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.id !== undefined ? { id: opts.id } : {}),
    ...(opts.position ? { position: opts.position } : {}),
  };
}

/**
 * Toasts (spec §3.7) on the themed `<Toaster />`. Text comes from the caller (translation files).
 * Success and info leave after 4 s, errors after 8 s.
 */
export const notify = {
  success: (title: string, opts: NotifyOptions = {}) => toast.success(title, options(opts, 4000)),
  info: (title: string, opts: NotifyOptions = {}) => toast.info(title, options(opts, 4000)),
  error: (title: string, opts: NotifyOptions = {}) => toast.error(title, options(opts, 8000)),
  dismiss: (id?: string | number) => toast.dismiss(id),
};

/* ---------------------------------------------------------------- EmptyState / ErrorState */

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** An icon element, e.g. `<Inbox />` (elements, not components, so server pages can pass it). */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links (e.g. "+ Yeni proje"). */
  action?: ReactNode;
  /** Tighter padding inside cards and panels. */
  compact?: boolean;
}

/** Nothing here yet: icon, title, short text and the next step. */
export function EmptyState({
  icon = <Inbox />,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
      {...props}
    >
      <span
        className="flex size-10 items-center justify-center rounded-lg border border-border-subtle bg-surface-subtle text-fg-muted shadow-xs [&_svg]:size-5"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** An icon element, e.g. `<Inbox />` (elements, not components, so server pages can pass it). */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Shows a retry button when given. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra actions next to retry (e.g. a link back). */
  action?: ReactNode;
  compact?: boolean;
}

/** Something failed: what happened, and a way to try again. Announced as an alert. */
export function ErrorState({
  icon = <CircleAlert />,
  title,
  description,
  onRetry,
  retryLabel,
  action,
  compact = false,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-danger-border bg-danger-subtle text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
      {...props}
    >
      <span
        className="flex size-10 items-center justify-center rounded-lg bg-surface text-danger-text shadow-xs [&_svg]:size-5"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {onRetry || action ? (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RotateCw aria-hidden />
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
