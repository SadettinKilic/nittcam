'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { focusRing } from '../lib/styles';

export interface InspectorRowProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Label on the left (muted). */
  label: ReactNode;
  /** Value on the right: one line, truncated rather than wrapped. */
  children: ReactNode;
  /** Mono read-out (default) or the UI font (names, words). */
  mono?: boolean;
  /** Props for the value element (e.g. `data-testid`, `title`). */
  valueProps?: ComponentPropsWithoutRef<'span'> & { 'data-testid'?: string };
}

/**
 * One inspector line (D-040, T249): label left, value right, one line, 32 px. Every right-hand
 * inspector (drawing board, Dizilim, Simülasyon, later 3D) is built from it, so values never
 * wrap at the default panel width. Wrap a list of rows in `InspectorRows` for the dividers.
 */
export function InspectorRow({
  label,
  children,
  mono = true,
  valueProps,
  className,
  ...rest
}: InspectorRowProps) {
  const { className: valueClass, ...valueRest } = valueProps ?? {};
  return (
    <div
      data-slot="inspector-row"
      className={cn('flex h-8 min-w-0 items-center justify-between gap-3 text-sm', className)}
      {...rest}
    >
      <span className="shrink-0 whitespace-nowrap text-fg-muted">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right whitespace-nowrap text-fg tabular-nums',
          mono && 'font-mono',
          valueClass,
        )}
        {...valueRest}
      >
        {children}
      </span>
    </div>
  );
}

/** A divided stack of `InspectorRow`s. */
export function InspectorRows({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col divide-y divide-border-subtle', className)} {...rest} />;
}

export interface InspectorGroupProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  /** Group heading (also the toggle's accessible name). */
  title: ReactNode;
  /** Open on first render (uncontrolled). Default true. */
  defaultOpen?: boolean;
  /** Extra content on the heading's right (a count, a status chip). */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * A collapsible inspector group (T130, D-040): a 32 px heading button with a chevron
 * (aria-expanded) above its rows. Collapsing keeps the content mounted but hidden.
 */
export function InspectorGroup({
  title,
  defaultOpen = true,
  aside,
  children,
  className,
  ...rest
}: InspectorGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section data-slot="inspector-group" className={cn('flex flex-col', className)} {...rest}>
      <div className="flex h-8 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            '-ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left text-xs font-semibold text-fg-muted hover:text-fg',
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
          <span className="truncate">{title}</span>
        </button>
        {aside}
      </div>
      <div id={id} hidden={!open} className="flex flex-col gap-1 pb-2">
        {children}
      </div>
    </section>
  );
}
