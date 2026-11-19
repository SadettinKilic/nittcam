import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn';

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
