'use client';

import { Label as LabelPrimitive } from 'radix-ui';
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'text-sm font-medium leading-5 text-fg select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:text-fg-disabled',
        className,
      )}
      {...props}
    />
  );
}

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Props a control inside a FormField picks up automatically (id, aria-describedby,
 * aria-invalid). Explicit props on the control win.
 */
export function useFieldControlProps(own: {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;
}) {
  const field = useContext(FieldContext);
  const invalid = own['aria-invalid'] ?? (field?.invalid ? true : undefined);
  return {
    id: own.id ?? field?.id,
    'aria-describedby': own['aria-describedby'] ?? field?.describedBy,
    'aria-invalid': invalid,
  };
}

export interface FormFieldProps {
  label: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Error text; also marks the control aria-invalid. */
  error?: ReactNode;
  /** Shown after the label, e.g. "(isteğe bağlı)". */
  optionalLabel?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint + error, wired for screen readers. */
export function FormField({
  label,
  hint,
  error,
  optionalLabel,
  id,
  className,
  children,
}: FormFieldProps) {
  const auto = useId();
  const controlId = id ?? `f${auto}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: !!error }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <Label htmlFor={controlId}>
          {label}
          {optionalLabel ? (
            <span className="ml-1 font-normal text-fg-subtle">{optionalLabel}</span>
          ) : null}
        </Label>
        {children}
        {error ? (
          <p id={errorId} className="text-xs leading-4 font-medium text-danger-text">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-xs leading-4 text-fg-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
