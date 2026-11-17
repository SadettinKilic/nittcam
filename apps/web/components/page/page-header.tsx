import { cn } from '@nittcam/ui';
import type { ReactNode } from 'react';

/** Width and padding of a redesigned page body (inside the shell's #content). */
export const pageContainer =
  'mx-auto flex w-full max-w-6xl min-w-0 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8';

/**
 * Page heading (T106): title, one-line description and actions. Actions sit on the title's
 * baseline on wide screens and drop below it on phones; they never wrap under the heading text.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Extra content under the description (e.g. a badge row). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-fg sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-pretty text-fg-muted sm:text-base">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Section heading with an optional link or button aligned to the right on the same line. */
export function SectionHeader({
  id,
  title,
  description,
  action,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={id} className="truncate text-base font-semibold tracking-tight text-fg">
          {title}
        </h2>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex h-6 shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Keyboard focus ring for links and custom controls (same as packages/ui `focusRing`). */
export const focusRing =
  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** A quiet text link with an arrow, for "Tüm projeler →" style links next to a section title. */
export const sectionLink = `inline-flex items-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap text-accent-text underline-offset-4 hover:underline [&_svg]:size-4 ${focusRing}`;
