'use client';

import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn, cva, type VariantProps } from '../lib/cn';
import { focusRing } from '../lib/styles';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-(--duration-fast) ease-out',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
    focusRing,
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover',
        secondary: 'bg-surface-hover text-fg hover:bg-surface-active',
        outline: 'border border-border-strong bg-surface text-fg shadow-xs hover:bg-surface-hover',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        destructive: 'bg-danger text-danger-fg shadow-xs hover:bg-danger-hover',
      },
      size: {
        sm: 'h-control-sm px-3 text-sm [&_svg]:size-4',
        md: 'h-control-md px-4 text-sm [&_svg]:size-4',
        lg: 'h-control-lg px-5 text-base [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next.js Link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner, sets aria-busy and blocks clicks; the label stays for screen readers. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="animate-spin" aria-hidden />
          </span>
          {/* opacity, not visibility: the label keeps the width and the accessible name */}
          <span className="inline-flex items-center gap-2 opacity-0">{children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

const iconSizes = { sm: 'size-8', md: 'size-10', lg: 'size-12' } as const;

export interface IconButtonProps extends Omit<ButtonProps, 'asChild' | 'aria-label'> {
  /** Required: icon-only buttons have no visible text. */
  'aria-label': string;
}

/** Square icon-only button. `aria-label` is required by the type. */
export function IconButton({
  className,
  variant = 'ghost',
  size = 'md',
  ...props
}: IconButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn('px-0', iconSizes[size ?? 'md'], className)}
      {...props}
    />
  );
}

/** Small inline spinner for loading areas (decorative; pair it with text). */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-fg-muted', className)} aria-hidden />;
}
