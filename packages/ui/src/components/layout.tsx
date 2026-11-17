'use client';

import { Separator as SeparatorPrimitive, Tabs as TabsPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { focusRing } from '../lib/styles';

/* ---------------------------------------------------------------- Separator */

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- Tabs */

type TabsVariant = 'segmented' | 'line';
const TabsVariantContext = createContext<TabsVariant>('segmented');

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  variant = 'segmented',
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        className={cn(
          'inline-flex items-center',
          variant === 'segmented'
            ? 'h-control-md gap-0.5 rounded-lg bg-surface-hover p-1'
            : 'h-control-md gap-4 border-b border-border',
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        focusRing,
        'inline-flex h-full items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap select-none',
        'text-fg-muted transition-[color,background-color,box-shadow] duration-(--duration-fast) ease-out',
        'hover:text-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
        variant === 'segmented'
          ? 'rounded-md px-3 data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm'
          : '-mb-px border-b-2 border-transparent px-0.5 data-[state=active]:border-accent data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(focusRing, 'mt-4 rounded-md data-[state=active]:animate-fade-in', className)}
      {...props}
    />
  );
}
