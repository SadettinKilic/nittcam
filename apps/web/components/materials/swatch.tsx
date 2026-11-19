import type { MaterialTone } from '@nittcam/core';
import { cn } from '@nittcam/ui';

/** Swatch classes per colour / texture key; tokens only (the wood tone family arrives with D-040). */
const TONE_CLASS: Record<MaterialTone, string> = {
  natural: 'bg-warning-subtle border-warning-border',
  oak: 'bg-warning-border border-warning-border',
  walnut: 'bg-warning-text border-warning-text',
  white: 'bg-surface border-border-strong',
  grey: 'bg-surface-active border-border-strong',
  anthracite: 'bg-fg-muted border-fg-muted',
  black: 'bg-fg border-fg',
  clear: 'bg-canvas border-dashed border-border-strong',
};

/** A small colour chip for a library material (T121). Decorative: the name carries the meaning. */
export function MaterialSwatch({ tone, className }: { tone: MaterialTone; className?: string }) {
  return (
    <span
      aria-hidden
      data-tone={tone}
      className={cn('inline-block size-4 shrink-0 rounded-sm border', TONE_CLASS[tone], className)}
    />
  );
}
