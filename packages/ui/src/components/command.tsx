'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { fuzzyScore } from '../lib/search';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './overlays';

/** Separator in an item value: text after it keeps the value unique (an id) and is not searched. */
export const COMMAND_ID_SEPARATOR = '';

function commandFilter(value: string, search: string, keywords?: string[]): number {
  const cut = value.indexOf(COMMAND_ID_SEPARATOR);
  return fuzzyScore(cut < 0 ? value : value.slice(0, cut), search, keywords);
}

/** cmdk root with Turkish-aware fuzzy filtering (ı/i, ş/s … folded). */
export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      filter={commandFilter}
      className={cn('flex h-full w-full flex-col overflow-hidden text-fg', className)}
      {...props}
    />
  );
}

export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible dialog title and description (visually hidden); text from the caller. */
  title: string;
  description: string;
  /** Accessible name of the command list. */
  label: string;
  children: ReactNode;
  /** Footer row (e.g. key hints). */
  footer?: ReactNode;
  /** Where focus goes on close; needed when the palette is opened without a Trigger. */
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}

/** Command palette in a dialog: top-aligned, wide, with the elevated xl shadow. */
export function CommandDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  children,
  footer,
  onCloseAutoFocus,
}: CommandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        data-testid="command-palette"
        onCloseAutoFocus={onCloseAutoFocus}
        className="top-[12vh] max-h-[min(32rem,76vh)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[16vh]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command label={label} loop className="min-h-0">
          {children}
        </Command>
        {footer ? (
          <div className="flex items-center gap-4 border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-4">
      <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <CommandPrimitive.Input
        className={cn(
          'h-12 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-[min(24rem,56vh)] overflow-x-hidden overflow-y-auto p-2', className)}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn('py-10 text-center text-sm text-fg-muted', className)}
      {...props}
    />
  );
}

export function CommandLoading({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Loading>) {
  return (
    <CommandPrimitive.Loading
      className={cn('px-2 py-2 text-sm text-fg-muted', className)}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden text-fg [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn('-mx-2 my-1 h-px bg-border-subtle', className)}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex min-h-10 cursor-default items-center gap-3 rounded-md px-2 text-sm text-fg outline-none select-none',
        'transition-colors duration-(--duration-instant)',
        'data-[selected=true]:bg-surface-hover data-[disabled=true]:pointer-events-none data-[disabled=true]:text-fg-disabled',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

/** Right-aligned shortcut keys inside an item. */
export function CommandShortcut({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('ml-auto hidden items-center gap-1 sm:flex', className)} {...props} />;
}
