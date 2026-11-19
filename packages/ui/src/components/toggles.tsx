'use client';

import { Check, Minus } from 'lucide-react';
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioGroupPrimitive,
  Switch as SwitchPrimitive,
} from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { focusRing } from '../lib/styles';
import { useFieldControlProps } from './form-field';

const box =
  'peer shrink-0 border border-border-strong bg-surface shadow-xs ' +
  'transition-[background-color,border-color] duration-(--duration-fast) ease-out ' +
  'hover:border-fg-subtle disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-invalid:border-danger';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  const field = useFieldControlProps(props);
  return (
    <CheckboxPrimitive.Root
      className={cn(
        box,
        focusRing,
        'grid size-4.5 place-content-center rounded-xs',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg',
        className,
      )}
      {...props}
      {...field}
    >
      <CheckboxPrimitive.Indicator className="data-[state=checked]:animate-pop-in">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5" strokeWidth={3} aria-hidden />
        ) : (
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/**
 * A light checkbox for long virtual lists (T118 perf): a plain `<button role="checkbox">` with the
 * Checkbox look, no Radix root, no hidden form input. Use it where hundreds of rows mount while
 * scrolling; use `Checkbox` everywhere else. The caller toggles in `onClick` (Space activates
 * the button, so keyboard and modifier keys arrive there too). Enter does not toggle it, as with a
 * native checkbox; the caller's `onKeyDown` still sees Enter (grid navigation).
 */
export function LiteCheckbox({
  checked,
  className,
  onKeyDown,
  ...props
}: Omit<ComponentProps<'button'>, 'role' | 'type'> & { checked: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      className={cn(
        box,
        focusRing,
        'grid size-4.5 place-content-center rounded-xs',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg',
        className,
      )}
      {...props}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        // A button fires click on Enter; a checkbox does not.
        if (e.key === 'Enter') e.preventDefault();
      }}
    >
      {checked ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  const field = useFieldControlProps(props);
  return (
    <SwitchPrimitive.Root
      className={cn(
        focusRing,
        'peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5',
        'bg-border-strong transition-colors duration-(--duration-base) ease-out',
        'data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
      {...field}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-accent-fg shadow-sm',
          'transition-transform duration-(--duration-base) ease-out',
          'data-[state=checked]:translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-2.5', className)} {...props} />;
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        box,
        focusRing,
        'grid size-4.5 place-content-center rounded-full',
        'data-[state=checked]:border-accent',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-accent data-[state=checked]:animate-pop-in" />
    </RadioGroupPrimitive.Item>
  );
}
