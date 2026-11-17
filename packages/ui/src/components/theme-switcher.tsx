'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';
import { cn } from '../lib/cn';
import { focusRing } from '../lib/styles';
import { useTheme, type ThemeChoice } from '../theme';

const noop = () => () => {};
/** False during SSR and hydration, true after: the stored theme is only known on the client. */
function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export interface ThemeSwitcherProps {
  /** Text from the translation file: group label and one label per option. */
  labels: { group: string; system: string; light: string; dark: string };
  /** Icons only (labels become aria-labels and tooltips). */
  compact?: boolean;
  className?: string;
}

const icons = { system: Monitor, light: Sun, dark: Moon } as const;

/** Sistem / Açık / Koyu segmented control (spec §3.7). */
export function ThemeSwitcher({ labels, compact = false, className }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const value = mounted ? (theme ?? 'system') : '';
  return (
    <RadioGroupPrimitive.Root
      aria-label={labels.group}
      orientation="horizontal"
      value={value}
      onValueChange={(v) => setTheme(v as ThemeChoice)}
      className={cn(
        'inline-flex h-control-sm items-center gap-0.5 rounded-lg bg-surface-hover p-0.5',
        className,
      )}
    >
      {(['system', 'light', 'dark'] as const).map((t) => {
        const Icon = icons[t];
        return (
          <RadioGroupPrimitive.Item
            key={t}
            value={t}
            aria-label={compact ? labels[t] : undefined}
            title={compact ? labels[t] : undefined}
            className={cn(
              focusRing,
              'inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fg-muted',
              'transition-[color,background-color,box-shadow] duration-(--duration-fast) ease-out hover:text-fg',
              'data-[state=checked]:bg-surface data-[state=checked]:text-fg data-[state=checked]:shadow-sm',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {compact ? null : labels[t]}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

/** Toast host (sonner) themed by our tokens; place once near the root. */
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'rounded-lg! border! border-border! bg-surface-raised! text-fg! shadow-lg! font-sans! text-sm!',
          description: 'text-fg-muted!',
          actionButton: 'bg-accent! text-accent-fg!',
          cancelButton: 'bg-surface-hover! text-fg!',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
