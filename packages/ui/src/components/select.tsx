'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { fieldBase, fieldFocus, floatingSurface, menuItem } from '../lib/styles';
import { useFieldControlProps } from './form-field';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  size = 'md',
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'sm' | 'md' | 'lg' }) {
  const field = useFieldControlProps(props);
  return (
    <SelectPrimitive.Trigger
      className={cn(
        fieldBase,
        fieldFocus,
        'flex items-center justify-between gap-2 px-3 text-left',
        'data-placeholder:text-fg-subtle [&>span]:truncate',
        size === 'sm' ? 'h-control-sm' : size === 'lg' ? 'h-control-lg text-base' : 'h-control-md',
        className,
      )}
      {...props}
      {...field}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          floatingSurface,
          'max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2 pt-2 pb-1 text-xs font-medium text-fg-subtle', className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn(menuItem, 'pr-8', className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="text-accent-text!" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  );
}
