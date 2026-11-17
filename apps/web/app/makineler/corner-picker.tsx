'use client';

import { Label, RadioGroup, RadioGroupItem, cn } from '@nittcam/ui';
import type { MachineProfile } from '@nittcam/core';

type Corner = MachineProfile['origin']['corner'];

const CORNERS: { value: Corner; pos: string; text: string }[] = [
  { value: 'backLeft', pos: 'top-0 left-0', text: 'items-start' },
  { value: 'backRight', pos: 'top-0 right-0', text: 'items-end' },
  { value: 'frontLeft', pos: 'bottom-0 left-0', text: 'items-start' },
  { value: 'frontRight', pos: 'bottom-0 right-0', text: 'items-end' },
];

/**
 * Program-zero corner as a picture of the table seen from above (T107): back on top, the operator
 * side at the bottom; the user clicks the corner. A radio group, so arrows and Tab work.
 */
export function CornerPicker({
  id,
  label,
  hint,
  value,
  options,
  front,
  back,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: Corner;
  options: Record<Corner, string>;
  front: string;
  back: string;
  onChange: (corner: Corner) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <Label id={`${id}-label`}>{label}</Label>
      <p id={`${id}-hint`} className="text-xs text-fg-muted">
        {hint}
      </p>
      <div className="mt-1 flex flex-col items-stretch gap-1 sm:max-w-sm">
        <span className="text-center text-xs text-fg-muted">{back}</span>
        <RadioGroup
          id={id}
          value={value}
          onValueChange={(v) => onChange(v as Corner)}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          className="relative block h-36 rounded-lg border border-border-strong bg-surface-subtle"
        >
          {/* The sheet on the table, just inside the table edge. */}
          <span
            aria-hidden
            className="absolute inset-5 rounded-sm border border-dashed border-border bg-surface"
          />
          {CORNERS.map((c) => {
            const active = c.value === value;
            return (
              <label
                key={c.value}
                className={cn(
                  'absolute flex cursor-pointer flex-col gap-1 p-2 text-xs',
                  c.pos,
                  c.text,
                  active ? 'font-medium text-accent-text' : 'text-fg-muted',
                )}
              >
                <RadioGroupItem
                  value={c.value}
                  aria-label={options[c.value]}
                  data-testid={`corner-${c.value}`}
                  className={cn(active && 'ring-4 ring-accent-subtle')}
                />
                <span aria-hidden className={c.value.startsWith('front') ? 'order-first' : ''}>
                  {options[c.value]}
                </span>
              </label>
            );
          })}
        </RadioGroup>
        <span className="text-center text-xs text-fg-muted">{front}</span>
      </div>
    </div>
  );
}
