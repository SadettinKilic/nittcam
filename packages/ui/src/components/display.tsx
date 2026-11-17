import type { ComponentProps } from 'react';
import { cn, cva, type VariantProps } from '../lib/cn';

/* ---------------------------------------------------------------- Badge */

export const badgeVariants = cva(
  'inline-flex h-5.5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-surface-subtle text-fg-muted',
        accent: 'border-accent-border bg-accent-subtle text-accent-text',
        success: 'border-success-border bg-success-subtle text-success-text',
        warning: 'border-warning-border bg-warning-subtle text-warning-text',
        danger: 'border-danger-border bg-danger-subtle text-danger-text',
        info: 'border-info-border bg-info-subtle text-info-text',
        solid: 'border-transparent bg-accent text-accent-fg',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

const dotColours = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  solid: 'bg-accent-fg',
} as const;

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  /** Small status dot before the text. */
  dot?: boolean;
}

export function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full', dotColours[variant ?? 'neutral'])}
        />
      ) : null}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Card */

export function Card({
  className,
  interactive = false,
  ...props
}: ComponentProps<'div'> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface text-fg shadow-xs',
        interactive &&
          'transition-[border-color,box-shadow] duration-(--duration-base) ease-out hover:border-border-strong hover:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn('text-base leading-6 font-semibold tracking-tight text-fg', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-fg-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-border-subtle px-5 py-3', className)}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- Skeleton */

/** Loading placeholder; decorative (announce loading with text elsewhere). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-shimmer rounded-md bg-surface-active', className)}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- Kbd */

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border',
        'border-b-2 bg-surface-subtle px-1 font-sans text-2xs font-medium text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}
